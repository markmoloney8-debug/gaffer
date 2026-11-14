-- Recovery email, so players can reset their own password. Run AFTER auth/auth.sql. Safe to run again.
--
-- Privacy rules built in:
--   * The address is stored ENCRYPTED by the account function (key = EMAIL_KEY secret), so the database and its backups only hold scrambled text.
--   * users.recovery_email is NOT readable by the app (the column is not granted to anon or authenticated),
--     so other players can never see it, and neither can the admin screens.
--   * The player reads their own through my_recovery(); only the account function (service key) reads it to send mail.
--   * Reset/verify tokens live in a table the app cannot touch at all, and only a hash of each token is stored.

alter table users add column if not exists recovery_email text;
alter table users add column if not exists recovery_verified_at timestamptz;
alter table users add column if not exists recovery_hint text;      -- masked copy, e.g. m****@gmail.com, shown to the player
alter table users drop constraint if exists users_recovery_email_format;
alter table users add constraint users_recovery_email_format
  check (recovery_email is null or char_length(recovery_email) <= 600);

-- Single-use, expiring links. purpose = 'reset' (forgot password) or 'verify' (confirm a recovery email).
create table if not exists auth_tokens (
  id          uuid primary key default gen_random_uuid(),
  username    text not null references users(username) on delete cascade,
  purpose     text not null check (purpose in ('reset', 'verify')),
  token_hash  text not null unique,
  email       text,                       -- the address a 'verify' token confirms
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists auth_tokens_user_idx on auth_tokens (username, purpose, created_at);
alter table auth_tokens enable row level security;
revoke all on auth_tokens from anon, authenticated;       -- no policies and no grants: service key only

-- What the signed-in player can see about their own recovery email
create or replace function my_recovery() returns table (email text, verified boolean)   -- email = masked hint only
language sql stable security definer set search_path = public as $$
  select u.recovery_hint, u.recovery_verified_at is not null from users u where u.auth_id = auth.uid()
$$;
revoke execute on function my_recovery() from public, anon;
grant  execute on function my_recovery() to authenticated;

-- Keep the column private even if someone later widens the users grants by mistake
revoke select (recovery_email, recovery_hint, recovery_verified_at) on users from anon, authenticated;
revoke update (recovery_email, recovery_hint, recovery_verified_at) on users from anon, authenticated;
