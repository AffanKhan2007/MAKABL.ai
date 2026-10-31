import type { FeatureType } from '../calibration/runs.ts';
import { withTx } from '../db/scope.ts';
import type { Horizon } from '../domain/types.ts';
import type { RelayModels } from '../estimator/estimator.ts';
import { DEFAULT_ACCEPTANCE } from '../spec/acceptance.ts';
import { db } from './db.ts';
import { userScope } from './session.ts';

// Projects and their versioned specs (working model 2.2 rule 1). The spec is the single
// source of truth the plan and the build read from. Every query runs as the current
// user under row-level security, so another user's project simply does not exist here.

export interface SpecFeature {
  type: FeatureType;
  name: string;
  /** User-approved acceptance criteria (FR-03). */
  acceptance: string[];
}

export interface ProjectSpec {
  idea: string;
  features: SpecFeature[];
  commercialUse: boolean;
  horizon: Horizon;
  monthlyVisitors: number | null;
  buildModel: string;
  unpricedItems: string[];
  /** Models for the relay phases around the build; null or missing for a build-only plan. */
  relay?: RelayModels | null;
  /** Planning assumptions set in the what-if explorer; missing means the estimator default. */
  retryRate?: number | null;
  caching?: boolean;
}

export type ProjectState =
  | 'draft' | 'scoped' | 'planned' | 'costed' | 'approved'
  | 'building' | 'paused' | 'verifying' | 'preview' | 'live';

export type BuildMode = 'simulated' | 'live';

export interface Project {
  id: string;
  ownerId: string;
  name: string;
  state: ProjectState;
  buildMode: BuildMode;
  createdAt: string;
  specVersion: number;
  spec: ProjectSpec;
}

export async function createProject(name: string, spec: ProjectSpec): Promise<string> {
  const scope = await userScope();
  return withTx(db(), scope, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into projects (owner_id, name, state, commercial_use, build_mode)
       values ($1, $2, 'costed', $3, 'live') returning id`,
      [scope.userId, name, spec.commercialUse],
    );
    const id = rows[0]!.id;
    await c.query(
      `insert into project_specs (project_id, version, spec, created_by) values ($1, 1, $2, 'user')`,
      [id, JSON.stringify(spec)],
    );
    return id;
  });
}

interface ProjectRow {
  id: string; owner_id: string; name: string; state: ProjectState; build_mode: BuildMode;
  created_at: Date; version: number; spec: ProjectSpec;
}

/** Specs saved before acceptance criteria existed get their type's defaults. */
export function normalizeSpec(spec: ProjectSpec): ProjectSpec {
  return {
    ...spec,
    features: spec.features.map((f) => ({ ...f, acceptance: f.acceptance?.length ? f.acceptance : [...DEFAULT_ACCEPTANCE[f.type]] })),
  };
}

const toProject = (r: ProjectRow): Project => ({
  id: r.id, ownerId: r.owner_id, name: r.name, state: r.state, buildMode: r.build_mode,
  createdAt: r.created_at.toISOString(), specVersion: r.version, spec: normalizeSpec(r.spec),
});

const LATEST = `
  select p.id, p.owner_id, p.name, p.state, p.build_mode, p.created_at, s.version, s.spec
    from projects p
    join lateral (select version, spec from project_specs
                   where project_id = p.id order by version desc limit 1) s on true`;

export async function listProjects(): Promise<Project[]> {
  return withTx(db(), await userScope(), async (c) => {
    const { rows } = await c.query<ProjectRow>(`${LATEST} order by p.created_at desc`);
    return rows.map(toProject);
  });
}

/** The project, if it exists and the user may see it. `userId` defaults to the current user. */
export async function getProject(id: string, userId?: string): Promise<Project | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return withTx(db(), await userScope(userId), async (c) => {
    const { rows } = await c.query<ProjectRow>(`${LATEST} where p.id = $1`, [id]);
    return rows[0] ? toProject(rows[0]) : null;
  });
}

/** A specific saved version of a project's spec, if the user may see it. */
export async function getSpecVersion(projectId: string, version: number): Promise<ProjectSpec | null> {
  return withTx(db(), await userScope(), async (c) => {
    const { rows } = await c.query<{ spec: ProjectSpec }>(
      'select spec from project_specs where project_id = $1 and version = $2', [projectId, version]);
    return rows[0] ? normalizeSpec(rows[0].spec) : null;
  });
}

/**
 * Save an edited spec as the next version (rule 1: specs are versioned, never edited in
 * place) and send the project back for plan approval. Returns the new version number.
 */
export async function saveSpecVersion(projectId: string, name: string, spec: ProjectSpec): Promise<number> {
  return withTx(db(), await userScope(), async (c) => {
    const { rows } = await c.query<{ v: number }>(
      `insert into project_specs (project_id, version, spec, created_by)
       select $1, coalesce(max(version), 0) + 1, $2, 'user' from project_specs where project_id = $1
       returning version as v`,
      [projectId, JSON.stringify(spec)]);
    await c.query(
      `update projects set name = $2, commercial_use = $3, state = 'costed' where id = $1`,
      [projectId, name, spec.commercialUse]);
    return rows[0]!.v;
  });
}

export async function setProjectState(id: string, state: ProjectState, userId?: string): Promise<void> {
  await withTx(db(), await userScope(userId), (c) =>
    c.query('update projects set state = $2 where id = $1', [id, state]));
}

export async function setBuildMode(id: string, mode: BuildMode): Promise<void> {
  await withTx(db(), await userScope(), (c) =>
    c.query('update projects set build_mode = $2 where id = $1', [id, mode]));
}

/** Record the user's approval of the cost plan (FR-04, D8). */
export async function recordPlanApproval(projectId: string, plan: unknown): Promise<void> {
  const scope = await userScope();
  await withTx(db(), scope, (c) => c.query(
    `insert into approvals (project_id, kind, status, request, decided_by, decided_at)
     values ($1, 'cost_plan', 'approved', $2, $3, now())`,
    [projectId, JSON.stringify(plan), scope.userId],
  ));
}

/** Task ids of features that already passed their checks, from the event log. */
export async function verifiedTasks(projectId: string, userId?: string): Promise<Set<string>> {
  return withTx(db(), await userScope(userId), async (c) => {
    const { rows } = await c.query<{ task_id: string }>(
      `select distinct task_id from activity_events where project_id = $1 and type = 'task_verified'`,
      [projectId],
    );
    return new Set(rows.map((r) => r.task_id));
  });
}
