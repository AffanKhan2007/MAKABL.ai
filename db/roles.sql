-- Runtime role. Row-level security does not apply to superusers or table owners, so the
-- app must connect as (or SET ROLE to) this role for tenant isolation to hold.
-- Run after schema.sql. Cluster-wide, so kept out of schema.sql.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'makabl_app') then
    create role makabl_app nologin;
  end if;
end $$;

grant usage on schema public to makabl_app;
grant select, insert, update, delete on all tables in schema public to makabl_app;
grant usage, select on all sequences in schema public to makabl_app;
-- Append-only tables: triggers already reject update/delete; revoke them too.
revoke update, delete on activity_events, cost_ledger_entries from makabl_app;
-- Calibration data is shared across tenants: the app may add runs and read them, never edit.
revoke update, delete on calibration_runs from makabl_app;
-- Credentials stay with the auth code: no sessions at all, and users without the hash.
revoke all on sessions from makabl_app;
revoke all on users from makabl_app;
grant select (id, email, created_at) on users to makabl_app;
