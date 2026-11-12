-- Emergency undo for auth.sql: puts the database back to "anyone with the app key can read and write".
-- Use only if the new sign-in release has to be pulled. Revert the app code first (or at the same time).
-- Players who were moved to the new sign-in will not be able to use the OLD app (their old password is gone);
-- the admin would need to set them a temporary password again once the new release is back.
do $$
declare t text;
begin
  foreach t in array array['users','groups','group_state','memberships','submissions','history','feedback','round','admins','reset_requests'] loop
    execute format('alter table %I disable row level security', t);
  end loop;
end $$;
grant select, insert, update, delete on users, groups, group_state, memberships, submissions, history, feedback, round to anon, authenticated;
grant insert on reset_requests to anon, authenticated;
