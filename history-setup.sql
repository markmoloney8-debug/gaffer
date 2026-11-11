-- Run once in the Supabase SQL editor (replaces the earlier history-setup.sql if you haven't run that yet).
-- Safe to run if the history table already exists.

-- 1. History of past rounds
create table if not exists history (
  id uuid primary key default gen_random_uuid(),
  series int not null,
  week int not null,
  username text not null,
  entry_name text not null,
  preds jsonb,
  correct int not null,
  total int not null,
  perfect boolean not null default false,
  archived_at timestamptz default now()
);
alter table history enable row level security;
drop policy if exists "public access" on history;
create policy "public access" on history for all using (true) with check (true);

-- 2. Groups
create table if not exists groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique,
  created_at timestamptz default now()
);
create table if not exists group_state (
  group_id uuid primary key references groups(id) on delete cascade,
  series int not null default 1,
  winners_found boolean not null default false
);
alter table groups enable row level security;
alter table group_state enable row level security;
drop policy if exists "public access" on groups;
drop policy if exists "public access" on group_state;
create policy "public access" on groups for all using (true) with check (true);
create policy "public access" on group_state for all using (true) with check (true);

alter table users       add column if not exists group_id uuid references groups(id);
alter table submissions add column if not exists group_id uuid references groups(id);
alter table history     add column if not exists group_id uuid references groups(id);
alter table round       add column if not exists series int default 1;

-- 3. Your existing friends become the first group (keep their current invite code)
insert into groups (name, invite_code) values ('Original Group', 'GAFFERPYW2026')
  on conflict (invite_code) do nothing;

insert into group_state (group_id, series, winners_found)
  select g.id,
         coalesce((select series from round where id = 1), 1),
         coalesce((select winners_found from round where id = 1), false)
  from groups g where g.invite_code = 'GAFFERPYW2026'
  on conflict (group_id) do nothing;

update users       set group_id = (select id from groups where invite_code = 'GAFFERPYW2026') where group_id is null;
update submissions set group_id = (select id from groups where invite_code = 'GAFFERPYW2026') where group_id is null;
update history     set group_id = (select id from groups where invite_code = 'GAFFERPYW2026') where group_id is null;

-- To rename the first group later:
-- update groups set name = 'Your name here' where invite_code = 'GAFFERPYW2026';

-- 4. Memberships: lets one player be in several groups
create table if not exists memberships (
  username text not null,
  group_id uuid not null references groups(id) on delete cascade,
  joined_at timestamptz default now(),
  primary key (username, group_id)
);
alter table memberships enable row level security;
drop policy if exists "public access" on memberships;
create policy "public access" on memberships for all using (true) with check (true);

-- Existing players keep the group they are in now
insert into memberships (username, group_id)
  select username, group_id from users where group_id is not null
  on conflict do nothing;

-- 5. Personalisation and feedback
alter table users  add column if not exists avatar text;
alter table users  add column if not exists avatar_color text;
alter table groups add column if not exists emoji text;

create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  group_id uuid references groups(id) on delete set null,
  category text not null default 'idea',
  message text not null,
  status text not null default 'new',        -- new -> sent (turned into a GitHub issue) -> done
  issue_url text,
  created_at timestamptz default now()
);
alter table feedback enable row level security;
drop policy if exists "public access" on feedback;
create policy "public access" on feedback for all using (true) with check (true);

-- Player-created groups: remember who started a group
alter table groups add column if not exists created_by text;
