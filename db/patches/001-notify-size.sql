-- Postgres limits a NOTIFY message to 8,000 bytes. Large events (a render's HTML, a long
-- brief) made the insert fail with "payload string too long", after a paid model call had
-- already been booked. A large event now broadcasts a small notice; the full event is still
-- stored, and the feed reads it from the table.
create or replace function notify_activity_event() returns trigger language plpgsql as $$
declare
  msg text;
begin
  msg := json_build_object(
    'seq', new.seq, 'project_id', new.project_id, 'task_id', new.task_id, 'type', new.type,
    'payload', new.payload, 'annotation', new.annotation, 'created_at', new.created_at)::text;
  if octet_length(msg) > 7000 then
    msg := json_build_object(
      'seq', new.seq, 'project_id', new.project_id, 'task_id', new.task_id, 'type', new.type,
      'payload', json_build_object('large', true), 'annotation', null, 'created_at', new.created_at)::text;
  end if;
  perform pg_notify('activity_events', msg);
  return new;
end $$;
