-- Behaviour tests for auth/delete-entry.sql. Needs auth.sql, delete-entry.sql and the helpers from recovery.test.sql style.
begin;
create function as_(role_name text, sub text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(sub, ''), true);
  execute 'set local role ' || role_name;
end $$;
create function back() returns void language plpgsql as $$ begin execute 'reset role'; perform set_config('request.jwt.claim.sub', '', true); end $$;
create function deleted_as(sub text, stmt text) returns bigint language plpgsql as $$
declare n bigint;
begin
  perform as_('authenticated', sub);
  execute 'with q as (' || stmt || ' returning 1) select count(*) from q' into n;
  perform back();
  return n;
end $$;
create function ok(cond boolean, msg text) returns void language plpgsql as $$ begin if not cond then raise exception 'FAIL: %', msg; end if; end $$;
create function ms(offset_minutes int) returns bigint language sql as $$ select ((extract(epoch from now()) + offset_minutes * 60) * 1000)::bigint $$;

insert into users(username, handle, auth_id) values
  ('dann', 'dann', '00000000-0000-0000-0000-0000000000a2'),
  ('dbob', 'dbob', '00000000-0000-0000-0000-0000000000b2'),
  ('dmark','dmark','00000000-0000-0000-0000-0000000000d2');
insert into admins values ('dmark');
insert into groups(id, name, invite_code) values ('20000000-0000-0000-0000-0000000000f1', 'DG', 'DGROUP01');
insert into memberships values ('dann','20000000-0000-0000-0000-0000000000f1'), ('dbob','20000000-0000-0000-0000-0000000000f1');
delete from round;
insert into round(id, league, fixtures, week, locked, winners_found) values (1, '{}',
  jsonb_build_array(jsonb_build_object('kickoffTs', ms(120)), jsonb_build_object('kickoffTs', ms(180)), jsonb_build_object('kickoffTs', ms(190)),
                    jsonb_build_object('kickoffTs', ms(200)), jsonb_build_object('kickoffTs', ms(210))), 1, false, false);
insert into submissions(id, username, entry_name, preds, group_id) values
  ('30000000-0000-0000-0000-000000000001', 'dann', 'Entry 1', '{"0":"home","1":"draw","2":"away","3":"home","4":"home"}', '20000000-0000-0000-0000-0000000000f1'),
  ('30000000-0000-0000-0000-000000000002', 'dann', 'Entry 2', '{"0":"away","1":"draw","2":"away","3":"home","4":"home"}', '20000000-0000-0000-0000-0000000000f1'),
  ('30000000-0000-0000-0000-000000000003', 'dbob',  'Entry 1', '{"0":"home","1":"home","2":"away","3":"home","4":"home"}', '20000000-0000-0000-0000-0000000000f1');

-- Before the lock: a player can delete their own entry, not someone else's
select ok(deleted_as('00000000-0000-0000-0000-0000000000b2', $$delete from submissions where id = '30000000-0000-0000-0000-000000000001'$$) = 0, 'bob cannot delete ann''s entry');
select ok(deleted_as('00000000-0000-0000-0000-0000000000a2', $$delete from submissions where id = '30000000-0000-0000-0000-000000000001'$$) = 1, 'ann can delete her own entry');
select ok((select count(*) from submissions where username = 'dann') = 1, 'her other entry is untouched');
select ok((select count(*) from submissions where username = 'dbob') = 1, 'bob''s entry is untouched');

-- After the lock: players cannot delete, the admin still can
update round set fixtures = jsonb_build_array(jsonb_build_object('kickoffTs', ms(0)), jsonb_build_object('kickoffTs', ms(60)), jsonb_build_object('kickoffTs', ms(70)),
                                              jsonb_build_object('kickoffTs', ms(80)), jsonb_build_object('kickoffTs', ms(90))) where id = 1;
select ok(deleted_as('00000000-0000-0000-0000-0000000000a2', $$delete from submissions where id = '30000000-0000-0000-0000-000000000002'$$) = 0, 'no deleting once entries are locked');
select ok(deleted_as('00000000-0000-0000-0000-0000000000d2', $$delete from submissions where id = '30000000-0000-0000-0000-000000000002'$$) = 1, 'the admin still can');

\echo ALL DELETE-ENTRY SQL TESTS PASSED
rollback;
