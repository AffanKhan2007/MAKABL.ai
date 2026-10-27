import type { FeatureType } from '../calibration/runs.ts';
import type { Horizon } from '../domain/types.ts';
import { db } from './db.ts';

// Projects and their versioned specs (working model 2.2 rule 1). The spec is the single
// source of truth the plan and the build read from.

export const DEV_USER_EMAIL = 'dev@makabl.local';

export interface SpecFeature {
  type: FeatureType;
  name: string;
}

export interface ProjectSpec {
  idea: string;
  features: SpecFeature[];
  commercialUse: boolean;
  horizon: Horizon;
  monthlyVisitors: number | null;
  buildModel: string;
  unpricedItems: string[];
}

export type ProjectState =
  | 'draft' | 'scoped' | 'planned' | 'costed' | 'approved'
  | 'building' | 'paused' | 'verifying' | 'preview' | 'live';

export interface Project {
  id: string;
  name: string;
  state: ProjectState;
  buildMode: 'simulated' | 'live';
  createdAt: string;
  specVersion: number;
  spec: ProjectSpec;
}

/** No sign-in yet: everything belongs to one local development user. */
export async function devUserId(): Promise<string> {
  const { rows } = await db().query<{ id: string }>(
    `insert into users (email) values ($1)
     on conflict (email) do update set email = excluded.email
     returning id`,
    [DEV_USER_EMAIL],
  );
  return rows[0]!.id;
}

export async function createProject(name: string, spec: ProjectSpec): Promise<string> {
  const owner = await devUserId();
  const c = await db().connect();
  try {
    await c.query('begin');
    const { rows } = await c.query<{ id: string }>(
      `insert into projects (owner_id, name, state, commercial_use, build_mode)
       values ($1, $2, 'costed', $3, 'simulated') returning id`,
      [owner, name, spec.commercialUse],
    );
    const id = rows[0]!.id;
    await c.query(
      `insert into project_specs (project_id, version, spec, created_by) values ($1, 1, $2, 'user')`,
      [id, JSON.stringify(spec)],
    );
    await c.query('commit');
    return id;
  } catch (err) {
    await c.query('rollback');
    throw err;
  } finally {
    c.release();
  }
}

interface ProjectRow {
  id: string; name: string; state: ProjectState; build_mode: 'simulated' | 'live';
  created_at: Date; version: number; spec: ProjectSpec;
}

const toProject = (r: ProjectRow): Project => ({
  id: r.id, name: r.name, state: r.state, buildMode: r.build_mode,
  createdAt: r.created_at.toISOString(), specVersion: r.version, spec: r.spec,
});

const LATEST = `
  select p.id, p.name, p.state, p.build_mode, p.created_at, s.version, s.spec
    from projects p
    join lateral (select version, spec from project_specs
                   where project_id = p.id order by version desc limit 1) s on true`;

export async function listProjects(): Promise<Project[]> {
  const owner = await devUserId();
  const { rows } = await db().query<ProjectRow>(`${LATEST} where p.owner_id = $1 order by p.created_at desc`, [owner]);
  return rows.map(toProject);
}

export async function getProject(id: string): Promise<Project | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const owner = await devUserId();
  const { rows } = await db().query<ProjectRow>(`${LATEST} where p.id = $1 and p.owner_id = $2`, [id, owner]);
  return rows[0] ? toProject(rows[0]) : null;
}

export async function setProjectState(id: string, state: ProjectState): Promise<void> {
  await db().query('update projects set state = $2 where id = $1', [id, state]);
}

/** Record the user's approval of the cost plan (FR-04, D8). */
export async function recordPlanApproval(projectId: string, plan: unknown): Promise<void> {
  const owner = await devUserId();
  await db().query(
    `insert into approvals (project_id, kind, status, request, decided_by, decided_at)
     values ($1, 'cost_plan', 'approved', $2, $3, now())`,
    [projectId, JSON.stringify(plan), owner],
  );
}
