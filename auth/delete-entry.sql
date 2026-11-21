-- delete-entry.sql
-- Run once in the Supabase SQL editor (after auth/auth.sql). Safe to run again.
-- Lets a player delete their OWN entry, but only while entries are still open
-- (until 1 minute before the first kick-off, the same lock that stops new entries).
-- The admin can still delete any entry, at any time, as before.

create or replace function entries_open() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select (extract(epoch from now()) * 1000)::bigint < min((f->>'kickoffTs')::bigint) - 60000
       from round r, jsonb_array_elements(r.fixtures) f where r.id = 1),
    true)
$$;
grant execute on function entries_open() to authenticated;

drop policy if exists sub_delete on submissions;
create policy sub_delete on submissions for delete to authenticated
  using (is_admin() or (username = me() and entries_open()));
