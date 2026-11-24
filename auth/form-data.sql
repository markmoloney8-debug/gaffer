-- Team form (for picking) and richer history (for trends). Safe to run at any time and safe to run twice:
-- it only ADDS things. Nothing existing is changed, and no entries are touched.
--   team_form : one row per Premier League team, refreshed by a scheduled job (service key). Players can only read it.
--   history   : two new optional columns so the weekly archive can keep each week's fixtures and results.
create table if not exists team_form (
  team       text primary key,
  position   integer,
  played     integer,
  won        integer,
  drawn      integer,
  lost       integer,
  gf         integer,
  ga         integer,
  points     integer,
  last5      text,                    -- e.g. 'WWDLW', oldest first
  home       jsonb,                   -- {p,w,d,l,gf,ga,last5}
  away       jsonb,
  updated_at timestamptz not null default now()
);
alter table team_form enable row level security;
revoke all on team_form from anon, authenticated;
grant select on team_form to authenticated;
drop policy if exists team_form_read on team_form;
create policy team_form_read on team_form for select to authenticated using (true);

alter table history add column if not exists fixtures jsonb;
alter table history add column if not exists results  jsonb;
