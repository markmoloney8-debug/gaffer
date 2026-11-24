-- form-data.sql: players can read team form but never write it; history keeps its rules and gains two columns.
-- Needs the same setup as permissions.test.sql, then form-data.sql.
begin;
create function as_(sub text, r text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', coalesce(sub, ''), true); execute 'set local role ' || r; end $$;
create function back() returns void language plpgsql as $$ begin execute 'reset role'; perform set_config('request.jwt.claim.sub', '', true); end $$;
create function try(who text, stmt text) returns text language plpgsql as $$
declare n bigint;
begin
  perform as_(case who when 'anon' then null else '00000000-0000-0000-0000-00000000000b' end, case who when 'anon' then 'anon' else 'authenticated' end);
  begin
    if stmt ~* '^\s*select' then execute 'select count(*) from (' || stmt || ') q' into n; else execute stmt; n := 1; end if;
  exception when others then perform back(); return 'DENIED'; end;
  perform back(); return case when n > 0 then 'ALLOWED' else 'NOROWS' end;
end $$;
create function check_(label text, got text, want text) returns void language plpgsql as $$
begin if got is distinct from want then raise exception 'FAIL % : got % wanted %', label, got, want; end if; end $$;

insert into team_form(team, position, played, points, last5) values ('Arsenal', 1, 12, 30, 'WWWDW');
select check_('signed-in player can read team form', try('bob', 'select * from team_form'), 'ALLOWED');
select check_('signed-out cannot read team form',    try('anon', 'select * from team_form'), 'DENIED');
select check_('player cannot insert team form',      try('bob', $$insert into team_form(team) values ('X')$$), 'DENIED');
select check_('player cannot update team form',      try('bob', $$update team_form set points = 99$$), 'DENIED');
select check_('player cannot delete team form',      try('bob', $$delete from team_form$$), 'DENIED');
select check_('player still cannot write history',   try('bob', $$insert into history(series, week, username) values (1, 9, 'bob')$$), 'DENIED');
select check_('history has the new columns', (select count(*)::text from information_schema.columns where table_name = 'history' and column_name in ('fixtures', 'results')), '2');
select check_('team_form survived untouched', (select points::text from team_form where team = 'Arsenal'), '30');
select 'form-data tests passed' as result;
rollback;
