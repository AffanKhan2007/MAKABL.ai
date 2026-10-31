-- MAKABL MVP schema (working model, section 8).
-- Principles: immutable ids and timestamps; versioned specs, estimates, prices and
-- approvals; currency and unit on every money value; every cost row carries a basis;
-- row-level tenant isolation on every table (policies at the bottom).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- enums
create type cost_basis       as enum ('estimated', 'usage_observed', 'invoice_confirmed');
create type line_class       as enum ('exact', 'conditional', 'empirical', 'unpriced');
create type cost_category    as enum ('one_time', 'recurring', 'usage_based', 'optional');
create type confidence_level as enum ('high', 'medium', 'low', 'unverified');
create type project_state    as enum ('draft', 'scoped', 'planned', 'costed', 'approved',
                                      'building', 'paused', 'verifying', 'preview', 'live');
create type task_status      as enum ('proposed', 'generated', 'executed', 'verified',
                                      'deployed', 'paused', 'failed');
create type approval_status  as enum ('pending', 'approved', 'declined', 'expired');
create type approval_kind    as enum ('scope', 'cost_plan', 'budget_raise', 'paid_resource',
                                      'recurring_charge', 'production_deploy', 'destructive_db');
create type reservation_status as enum ('held', 'settled', 'released');

-- ---------------------------------------------------------------- core
create table users (
  id             uuid primary key default gen_random_uuid(),
  email          text not null unique,
  password_hash  text,                  -- scrypt; null means the account cannot sign in
  created_at     timestamptz not null default now()
);

-- Signed-in sessions. The cookie holds a random token; only its SHA-256 is stored, so
-- a leaked table cannot be replayed as cookies. Read only by the auth code (login role).
create table sessions (
  token_hash    text primary key,
  user_id       uuid not null references users(id) on delete cascade,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  last_seen_at  timestamptz not null default now()
);
create index sessions_user on sessions (user_id);

create table projects (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references users(id),
  name           text not null,
  state          project_state not null default 'draft',
  commercial_use boolean not null default true,  -- D11: gate free tiers on commercial use
  -- 'simulated' remains only to identify historical projects; new projects use live.
  build_mode     text not null default 'live' check (build_mode in ('simulated', 'live')),
  created_at     timestamptz not null default now()
);

create table project_specs (
  project_id  uuid not null references projects(id),
  version     int  not null,
  spec        jsonb not null,           -- assumptions[], stories[], architecture, budget...
  created_by  text not null,            -- 'user' or agent role; agents propose, never silently edit
  created_at  timestamptz not null default now(),
  primary key (project_id, version)
);

create table artifacts (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id),
  kind        text not null,            -- brief, schema, openapi, code, test_report...
  path        text not null,
  created_at  timestamptz not null default now()
);

create table artifact_versions (
  artifact_id  uuid not null references artifacts(id),
  version      int  not null,
  content_ref  text not null,           -- blob or git ref
  spec_version int  not null,
  created_at   timestamptz not null default now(),
  primary key (artifact_id, version)
);

-- ---------------------------------------------------------------- orchestration
create table tasks (
  id                 text primary key,  -- e.g. t_0042
  project_id         uuid not null references projects(id),
  objective          text not null,
  contract           jsonb not null,    -- inputs, output_schema, acceptance, permissions
  status             task_status not null default 'proposed',
  budget_ceiling     numeric(12,6) not null,
  currency           char(3) not null default 'USD',
  retry_limit        int not null,
  retry_cost_limit   numeric(12,6) not null,
  timeout_s          int not null,
  created_at         timestamptz not null default now()
);

create table task_dependencies (
  task_id     text not null references tasks(id),
  depends_on  text not null references tasks(id),
  primary key (task_id, depends_on)
);

create table agent_runs (
  id             uuid primary key default gen_random_uuid(),
  task_id        text not null references tasks(id),
  attempt        int not null,
  provider       text not null,
  model          text not null,
  input_tokens   bigint,
  output_tokens  bigint,
  cost           numeric(12,6),
  currency       char(3) not null default 'USD',
  started_at     timestamptz not null default now(),
  finished_at    timestamptz
);

-- Append-only. The feed reads only from here (rule 5, FR-27).
create table activity_events (
  seq         bigserial primary key,
  project_id  uuid not null references projects(id),
  task_id     text,
  type        text not null,            -- task_started, provider_call, budget_blocked, ...
  payload     jsonb not null,
  annotation  text,                     -- model text may annotate, never create, an event
  created_at  timestamptz not null default now()
);

create table approvals (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id),
  kind          approval_kind not null,
  status        approval_status not null default 'pending',
  request       jsonb not null,         -- FR-14: reason, blocked task, range, alternatives,
                                        -- who bills, cancellability, consequence of declining
  decided_by    uuid references users(id),
  decided_at    timestamptz,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------- cost
create table provider_products (
  id        text primary key,           -- e.g. anthropic/claude-opus-5-5
  provider  text not null,
  product   text not null,
  category  text not null               -- llm, host, database, git, domain
);

create table pricing_versions (
  id                text primary key,
  product_id        text not null references provider_products(id),
  plan              text not null,
  region            text,
  currency          char(3) not null,
  unit              text not null,
  rate_or_tiers     jsonb not null,
  minimum_charge    numeric(12,6),
  included_usage    jsonb,
  free_limits       jsonb,
  billing_period    text,
  commercial_use    text not null,      -- allowed | prohibited | unknown
  source_url        text not null,
  verified_at       date,               -- null = never verified from an official source
  confidence        confidence_level not null,
  revalidate_after  date
);

create table cost_estimates (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects(id),
  spec_version int not null,
  horizon      text not null,           -- build_only | first_month | first_12_months
  path         text not null,           -- free | paid
  totals       jsonb not null,          -- {low, expected, high}
  currency     char(3) not null,
  created_at   timestamptz not null default now()
);

create table cost_estimate_items (
  id           uuid primary key default gen_random_uuid(),
  estimate_id  uuid not null references cost_estimates(id),
  label        text not null,
  category     cost_category not null,
  line_class   line_class not null,
  unit         text not null,
  quantity_assumption text not null,
  low          numeric(12,6),           -- null when unpriced
  expected     numeric(12,6),
  high         numeric(12,6),
  currency     char(3) not null,
  rate_source  text,                    -- pricing_versions.id
  confidence   confidence_level not null
);

-- Check-and-reserve is serialised per project by pg_advisory_xact_lock in the Gate store.
create table budgets (
  project_id        uuid primary key references projects(id),
  project_cap       numeric(12,6) not null,
  monthly_cap       numeric(12,6) not null,
  default_task_ceiling numeric(12,6),   -- per-task ceilings normally come from the task contract
  currency          char(3) not null default 'USD',
  updated_at        timestamptz not null default now()
);

-- Written BEFORE any side effect; idempotency_key makes resumed steps safe.
create table reservations (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references projects(id),
  task_id          text not null,
  idempotency_key  text not null,
  worst_case       numeric(12,6) not null,
  observed         numeric(12,6),         -- set on settle
  currency         char(3) not null,
  month            char(7) not null,      -- YYYY-MM the spend counts against
  status           reservation_status not null default 'held',
  result           jsonb,                 -- replayed when a resumed step reuses the key
  failed           boolean not null default false,  -- call threw: result unknown, never replayed
  created_at       timestamptz not null default now(),
  settled_at       timestamptz,
  unique (project_id, idempotency_key)
);
create index reservations_project_month on reservations (project_id, month) where status <> 'released';

create table usage_events (
  id              uuid primary key default gen_random_uuid(),
  reservation_id  uuid references reservations(id),
  provider        text not null,
  usage           jsonb not null,       -- raw usage fields from the provider response
  created_at      timestamptz not null default now()
);

create table cost_ledger_entries (
  id              uuid primary key default gen_random_uuid(),
  ledger          text not null check (ledger in ('customer', 'platform_delivery')),
  project_id      uuid not null references projects(id),
  task_id         text,
  reservation_id  uuid references reservations(id),
  amount          numeric(12,6) not null,
  currency        char(3) not null,
  basis           cost_basis not null,
  description     text not null,
  created_at      timestamptz not null default now()
);

-- One feature built to completion or abandonment, retries included. The Estimator
-- calibrates from these. Platform data: token counts and costs only, no project
-- content, pooled across tenants, so no project_id and no RLS.
create table calibration_runs (
  id                     uuid primary key default gen_random_uuid(),
  feature_type           text not null,
  model                  text not null,         -- registry id, e.g. anthropic/claude-opus-5-5
  calls                  int not null check (calls > 0),
  attempts               int not null check (attempts > 0),
  input_tokens           bigint not null,
  output_tokens          bigint not null,
  cache_write_5m_tokens  bigint not null,
  cache_write_1h_tokens  bigint not null,
  cache_read_tokens      bigint not null,
  cost                   numeric(12,6) not null, -- what the Budget Gate booked
  currency               char(3) not null,
  verified               boolean not null,       -- passed its verification gates
  probe_cost             numeric(12,6),          -- cheap probe run on the same task, if any
  quoted_low             numeric(12,6),          -- range quoted before the build
  quoted_high            numeric(12,6),
  created_at             timestamptz not null default now()
);
create index calibration_runs_feature on calibration_runs (feature_type, model);

-- Tool results already shown to the model, so a build resumed after a pause or a
-- restart replays the same history. First write wins (insert ... on conflict do nothing).
create table build_tool_results (
  project_id  uuid not null references projects(id),
  step_key    text not null,         -- <task>:a<attempt>:t<turn>:<tool_use id>
  content     text not null,
  is_error    boolean not null,
  created_at  timestamptz not null default now(),
  primary key (project_id, step_key)
);

-- ---------------------------------------------------------------- delivery
create table environments (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id),
  kind        text not null check (kind in ('preview', 'production')),
  url         text
);

create table deployments (
  id              uuid primary key default gen_random_uuid(),
  environment_id  uuid not null references environments(id),
  commit_sha      text not null,
  approval_id     uuid references approvals(id),  -- required for production (FR-24)
  health          text,
  created_at      timestamptz not null default now()
);

create table test_runs (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id),
  task_id     text,
  gate        text not null,            -- G1..G5
  check_name  text not null,
  passed      boolean not null,
  authored_by text not null,            -- who wrote the test: user | platform | agent
  log_ref     text,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- secrets
create table secret_refs (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id),
  provider    text not null,
  vault_path  text not null,            -- pointer only, never the value (NFR-02)
  scopes      text[] not null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- append-only guards
-- The one exception is deleting a whole project at its owner's request (NFR-11): the
-- purge transaction sets makabl.purge_project to that project's id, and only rows of
-- that project may then be deleted. makabl_app has no delete grant on these tables, so
-- only the login role's purge code can get here.
create function forbid_mutation() returns trigger language plpgsql as $$
begin
  -- Nested, not AND-ed: calibration_runs has no project_id, and SQL does not promise
  -- to short-circuit, so the column is only read on tables that have it.
  if tg_op = 'DELETE' and tg_table_name in ('activity_events', 'cost_ledger_entries') then
    if old.project_id::text = current_setting('makabl.purge_project', true) then
      return old;
    end if;
  end if;
  raise exception '% is append-only', tg_table_name;
end $$;

create trigger activity_events_append_only before update or delete on activity_events
  for each row execute function forbid_mutation();
create trigger ledger_append_only before update or delete on cost_ledger_entries
  for each row execute function forbid_mutation();
create trigger calibration_runs_append_only before update or delete on calibration_runs
  for each row execute function forbid_mutation();

-- Live feed: NOTIFY fires only when the inserting transaction commits.
create function notify_activity_event() returns trigger language plpgsql as $$
begin
  perform pg_notify('activity_events', json_build_object(
    'seq', new.seq, 'project_id', new.project_id, 'task_id', new.task_id, 'type', new.type,
    'payload', new.payload, 'annotation', new.annotation, 'created_at', new.created_at)::text);
  return new;
end $$;

create trigger activity_events_notify after insert on activity_events
  for each row execute function notify_activity_event();

-- ---------------------------------------------------------------- tenant isolation (NFR-01)
-- The app connects as a non-owner role and sets `app.user_id` per transaction; every
-- project-scoped table checks ownership. With the setting missing, nothing is visible.
alter table users enable row level security;
create policy users_self on users
  using (id = nullif(current_setting('app.user_id', true), '')::uuid);

alter table projects enable row level security;
create policy projects_owner on projects
  using (owner_id = nullif(current_setting('app.user_id', true), '')::uuid);

do $$
declare t text;
begin
  foreach t in array array['project_specs','artifacts','tasks','activity_events','approvals',
                           'cost_estimates','budgets','reservations','cost_ledger_entries',
                           'environments','test_runs','secret_refs','build_tool_results']
  loop
    execute format('alter table %I enable row level security', t);
    execute format($p$create policy %I_owner on %I using (
      project_id in (select id from projects
                     where owner_id = nullif(current_setting('app.user_id', true), '')::uuid)
    )$p$, t, t);
  end loop;
end $$;

-- Child tables without a project_id reach it through their parent. The subquery on the
-- parent is itself filtered by the parent's policy, so these see exactly what it sees.
alter table artifact_versions enable row level security;
create policy artifact_versions_owner on artifact_versions
  using (artifact_id in (select id from artifacts));
alter table task_dependencies enable row level security;
create policy task_dependencies_owner on task_dependencies
  using (task_id in (select id from tasks));
alter table agent_runs enable row level security;
create policy agent_runs_owner on agent_runs
  using (task_id in (select id from tasks));
alter table usage_events enable row level security;
create policy usage_events_owner on usage_events
  using (reservation_id in (select id from reservations));
alter table deployments enable row level security;
create policy deployments_owner on deployments
  using (environment_id in (select id from environments));

-- Shared reference data, deliberately without RLS: provider_products, pricing_versions
-- (public prices) and calibration_runs (token counts and costs only, pooled by design).
