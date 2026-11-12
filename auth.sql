-- ═══════════════════════════════════════════════════════════════════════════
-- The Gaffer: real sign-in and database lock-down  (auth.sql)
-- Run LAST, at cutover, after history-setup.sql and hardening.sql.
-- Idempotent: safe to run more than once.
--
-- After this runs, the public key on its own can no longer read or change anything
-- important. Players must be signed in, and they can only see their own groups.
-- The OLD version of the site stops working. Deploy the new site straight afterwards.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. Accounts: link to sign-in, case-insensitive handle ────────────────
alter table users add column if not exists auth_id uuid unique;
alter table users add column if not exists handle  text;
alter table users alter column password_hash drop not null;     -- new accounts have no old-style hash

-- Turns a username into the "handle" used for the sign-in email (handle@gaffers5.com).
-- MUST match emailLocal() in supabase/functions/auth/handler.js.
create or replace function handle_for(u text) returns text language plpgsql immutable as $$
declare out text := ''; ch text; i int;
begin
  u := lower(u);
  for i in 1 .. char_length(u) loop
    ch := substr(u, i, 1);
    if ch ~ '^[a-z0-9]$' then out := out || ch;
    elsif ch = ' ' then out := out || '-s-';
    elsif ch = '_' then out := out || '-u-';
    elsif ch = '.' then out := out || '-d-';
    elsif ch = '-' then out := out || '-h-';
    else out := out || '-x' || encode(convert_to(ch, 'UTF8'), 'hex') || '-';
    end if;
  end loop;
  return out;
end $$;

update users set handle = handle_for(username) where handle is null;
create unique index if not exists users_handle_key on users(handle);

create table if not exists admins (username text primary key references users(username) on delete cascade);
insert into admins (username) select username from users where username = 'MarkMolo' on conflict do nothing;

create table if not exists reset_requests (
  id         uuid primary key default gen_random_uuid(),
  username   text not null,
  note       text,
  status     text not null default 'new',
  created_at timestamptz not null default now()
);

-- ─── 2. Who is signed in? ──────────────────────────────────────────────────
create or replace function me() returns text language sql stable security definer set search_path = public as
$$ select username from users where auth_id = auth.uid() $$;

create or replace function is_admin() returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from admins a join users u on u.username = a.username where u.auth_id = auth.uid()) $$;

create or replace function is_member(gid uuid) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from memberships m join users u on u.username = m.username where m.group_id = gid and u.auth_id = auth.uid()) $$;

create or replace function shares_group(other text) returns boolean language sql stable security definer set search_path = public as
$$ select exists (
     select 1 from memberships a
     join memberships b on b.group_id = a.group_id
     join users u on u.username = a.username
     where u.auth_id = auth.uid() and b.username = other) $$;

-- true once the first kick-off is less than a minute away (entries are locked, picks may be shown)
create or replace function picks_visible() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select now() >= to_timestamp((min((f->>'kickoffTs')::bigint) - 60000) / 1000.0)
       from round r, jsonb_array_elements(r.fixtures) f where r.id = 1), false) $$;

-- ─── 3. Start from nothing, then grant exactly what the app needs ─────────
do $$
declare p record;
begin
  for p in select schemaname, tablename, policyname from pg_policies
           where schemaname = 'public' and tablename in
             ('users','groups','group_state','memberships','submissions','history','feedback','round','admins','reset_requests')
  loop execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename); end loop;
end $$;

alter table users          enable row level security;
alter table groups         enable row level security;
alter table group_state    enable row level security;
alter table memberships    enable row level security;
alter table submissions    enable row level security;
alter table history        enable row level security;
alter table feedback       enable row level security;
alter table round          enable row level security;
alter table admins         enable row level security;
alter table reset_requests enable row level security;

revoke all on users, groups, group_state, memberships, submissions, history, feedback, round, admins, reset_requests from anon, authenticated;

-- users: names and avatars of people you share a group with. Never the old password hash.
grant select (username, avatar, avatar_color, created_at) on users to authenticated;
grant update (avatar, avatar_color) on users to authenticated;
create policy users_read   on users for select to authenticated using (username = me() or shares_group(username) or is_admin());
create policy users_update on users for update to authenticated using (username = me()) with check (username = me());

-- groups
grant select (id, name, invite_code, emoji, created_at, created_by) on groups to authenticated;
grant insert (name, invite_code, emoji, created_by), update (emoji) on groups to authenticated;
create policy groups_read   on groups for select to authenticated using (is_member(id) or is_admin());
create policy groups_admin  on groups for insert to authenticated with check (is_admin());
create policy groups_emoji  on groups for update to authenticated using (is_admin()) with check (is_admin());

-- group_state (winner / run status)
grant select, insert on group_state to authenticated;
grant update (winners_found) on group_state to authenticated;
create policy gs_read   on group_state for select to authenticated using (is_member(group_id) or is_admin());
create policy gs_insert on group_state for insert to authenticated with check (is_admin());
create policy gs_update on group_state for update to authenticated using (is_member(group_id) or is_admin()) with check (is_member(group_id) or is_admin());

-- memberships: read only. Joining goes through join_group().
grant select on memberships to authenticated;
create policy mem_read on memberships for select to authenticated using (is_member(group_id) or is_admin());

-- submissions: write your own entries. Others' picks are only available through group_entries().
grant select, insert, update on submissions to authenticated;
grant delete on submissions to authenticated;
create policy sub_read   on submissions for select to authenticated using (username = me() or is_admin());
create policy sub_insert on submissions for insert to authenticated with check (username = me());
create policy sub_update on submissions for update to authenticated using (username = me()) with check (username = me());
create policy sub_delete on submissions for delete to authenticated using (is_admin());

-- history
grant select on history to authenticated;
create policy hist_read on history for select to authenticated using (is_member(group_id) or is_admin());

-- feedback
grant select, insert, update on feedback to authenticated;
create policy fb_insert on feedback for insert to authenticated with check (username = me());
create policy fb_read   on feedback for select to authenticated using (is_admin());
create policy fb_update on feedback for update to authenticated using (is_admin()) with check (is_admin());

-- round: everyone signed in can read. Admin changes anything; anyone can flip "locked" on once.
grant select, insert, update, delete on round to authenticated;
create policy round_read   on round for select to authenticated using (true);
create policy round_admin  on round for all    to authenticated using (is_admin()) with check (is_admin());
create policy round_locked on round for update to authenticated using (true) with check (true);

create or replace function round_guard() returns trigger language plpgsql as $$
begin
  if auth.uid() is null or is_admin() then return new; end if;           -- service key (scheduled jobs) and the admin
  if new.locked is true and old.locked is not true
     and (to_jsonb(new) - 'locked' - 'created_at') = (to_jsonb(old) - 'locked' - 'created_at') then
    return new;                                                         -- players may only lock a finished round
  end if;
  raise exception 'Only the admin can change the round';
end $$;
drop trigger if exists round_guard on round;
create trigger round_guard before update on round for each row execute function round_guard();

-- password reset requests: anyone (even signed out) can ask. Only the admin can read them.
grant insert (username, note) on reset_requests to anon, authenticated;
grant select, update on reset_requests to authenticated;
create policy rr_insert on reset_requests for insert to anon, authenticated with check (true);
create policy rr_read   on reset_requests for select to authenticated using (is_admin());
create policy rr_update on reset_requests for update to authenticated using (is_admin()) with check (is_admin());

create or replace function reset_requests_rules() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.status := 'new'; new.created_at := now();
  if char_length(new.username) < 1 or char_length(new.username) > 30 then raise exception 'Enter your username'; end if;
  if new.note is not null and char_length(new.note) > 300 then raise exception 'Note too long'; end if;
  if exists (select 1 from reset_requests where lower(username) = lower(new.username) and created_at > now() - interval '10 minutes') then
    raise exception 'Already requested. Give it a few minutes';
  end if;
  if (select count(*) from reset_requests where created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many requests right now';
  end if;
  return new;
end $$;
drop trigger if exists reset_requests_rules on reset_requests;
create trigger reset_requests_rules before insert on reset_requests for each row execute function reset_requests_rules();

-- ─── 4. Actions that need more than a plain table write ───────────────────
create or replace function join_group(code text) returns groups language plpgsql security definer set search_path = public as $$
declare g groups; who text := me();
begin
  if who is null then raise exception 'Not signed in'; end if;
  select * into g from groups where invite_code = upper(trim(code));
  if not found then raise exception 'Invalid invite code'; end if;
  insert into memberships (username, group_id) values (who, g.id) on conflict do nothing;
  return g;
end $$;

create or replace function create_group(p_name text, p_emoji text default null) returns groups language plpgsql security definer set search_path = public as $$
declare g groups; who text := me(); alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; code text := ''; i int;
begin
  if who is null then raise exception 'Not signed in'; end if;
  for i in 1 .. 8 loop code := code || substr(alphabet, 1 + floor(random() * 32)::int, 1); end loop;
  insert into groups (name, invite_code, emoji, created_by) values (trim(p_name), code, nullif(p_emoji, ''), who) returning * into g;
  insert into group_state (group_id) values (g.id) on conflict do nothing;
  insert into memberships (username, group_id) values (who, g.id);
  return g;
end $$;

-- Everyone's entries in a group. Other players' picks stay hidden until entries lock.
create or replace function group_entries(gid uuid)
returns table (id uuid, username text, entry_name text, preds jsonb, group_id uuid, submitted_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_member(gid) or is_admin()) then raise exception 'Not a member of this group'; end if;
  return query
    select s.id, s.username, s.entry_name,
           case when s.username = me() or picks_visible() then s.preds else '{}'::jsonb end,
           s.group_id, s.submitted_at
    from submissions s where s.group_id = gid order by s.submitted_at;
end $$;

revoke execute on function join_group(text), create_group(text, text), group_entries(uuid) from public, anon;
grant  execute on function join_group(text), create_group(text, text), group_entries(uuid) to authenticated;
grant  execute on function me(), is_admin(), is_member(uuid), shares_group(text), picks_visible() to authenticated, anon;
