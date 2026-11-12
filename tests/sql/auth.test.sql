-- Behaviour tests for auth.sql. Needs baseline.sql, history-setup.sql, hardening.sql, auth-stub.sql and auth.sql applied.
begin;

create function as_(role_name text, sub text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(sub, ''), true);
  execute 'set local role ' || role_name;
end $$;
create function back() returns void language plpgsql as $$ begin execute 'reset role'; perform set_config('request.jwt.claim.sub', '', true); end $$;

-- run stmt as a role; it must fail with the given text
create function denied(role_name text, sub text, stmt text, pattern text) returns void language plpgsql as $$
begin
  perform as_(role_name, sub);
  begin
    execute stmt;
  exception when others then
    perform back();
    if sqlerrm like '%' || pattern || '%' then return; end if;
    raise exception 'wrong error for [%] as %: got [%], wanted [%]', stmt, role_name, sqlerrm, pattern;
  end;
  perform back();
  raise exception 'expected failure but it worked: % (as %)', stmt, role_name;
end $$;
-- run stmt as a role, return how many rows came back
create function rows_as(role_name text, sub text, stmt text) returns bigint language plpgsql as $$
declare n bigint;
begin
  perform as_(role_name, sub);
  begin
    execute 'with q as (' || stmt || ') select count(*) from q' into n;
  exception when others then perform back(); raise; end;
  perform back();
  return n;
end $$;
create function works(role_name text, sub text, stmt text) returns void language plpgsql as $$
begin
  perform as_(role_name, sub);
  begin execute stmt; exception when others then perform back(); raise; end;
  perform back();
end $$;
create function ok(cond boolean, msg text) returns void language plpgsql as $$ begin if not cond then raise exception 'FAIL: %', msg; end if; end $$;
create function ms(offset_minutes int) returns bigint language sql as $$ select ((extract(epoch from now()) + offset_minutes * 60) * 1000)::bigint $$;

-- People: ann + bob in G1, carl in G2, mark is the admin.
insert into users(username, handle, auth_id) values
  ('ann',  'ann',  '00000000-0000-0000-0000-00000000000a'),
  ('bob',  'bob',  '00000000-0000-0000-0000-00000000000b'),
  ('carl', 'carl', '00000000-0000-0000-0000-00000000000c'),
  ('mark', 'mark', '00000000-0000-0000-0000-00000000000d');
insert into admins values ('mark');
insert into groups(id, name, invite_code) values
  ('10000000-0000-0000-0000-000000000001', 'G1', 'GROUPONE'),
  ('10000000-0000-0000-0000-000000000002', 'G2', 'GROUPTWO');
insert into group_state(group_id) values ('10000000-0000-0000-0000-000000000001'), ('10000000-0000-0000-0000-000000000002') on conflict do nothing;
insert into memberships values ('ann','10000000-0000-0000-0000-000000000001'), ('bob','10000000-0000-0000-0000-000000000001'),
                               ('carl','10000000-0000-0000-0000-000000000002');
insert into round(id, league, fixtures, week, locked) values (1, '{}',
  (select jsonb_agg(jsonb_build_object('kickoffTs', ms(180 + i))) from generate_series(0,4) i), 1, false);
insert into history(group_id, series, week, username, entry_name, preds, correct, total, perfect) values
  ('10000000-0000-0000-0000-000000000001', 1, 1, 'ann', 'Entry 1', '{}', 3, 5, false),
  ('10000000-0000-0000-0000-000000000002', 1, 1, 'carl', 'Entry 1', '{}', 5, 5, true);

-- ── Signed out: nothing ───────────────────────────────────────────────────────
select denied('anon', null, 'select * from users',         'permission denied');
select denied('anon', null, 'select * from groups',        'permission denied');
select denied('anon', null, 'select * from submissions',   'permission denied');
select denied('anon', null, 'select * from round',         'permission denied');
select denied('anon', null, 'select * from memberships',   'permission denied');
select denied('anon', null, 'select * from history',       'permission denied');
select denied('anon', null, 'select * from feedback',      'permission denied');
select denied('anon', null, 'select * from reset_requests','permission denied');
select denied('anon', null, $$insert into submissions(username, entry_name, preds, group_id) values ('ann','x','{}','10000000-0000-0000-0000-000000000001')$$, 'permission denied');
select denied('anon', null, $$select join_group('GROUPONE')$$, 'permission denied');

-- ── Profiles ──────────────────────────────────────────────────────────────────
select ok(rows_as('authenticated', '00000000-0000-0000-0000-00000000000a', 'select username from users') = 2, 'ann sees herself and bob, not carl or mark');
select denied('authenticated', '00000000-0000-0000-0000-00000000000a', 'select password_hash from users', 'permission denied');
select denied('authenticated', '00000000-0000-0000-0000-00000000000a', 'select auth_id from users', 'permission denied');
select denied('authenticated', '00000000-0000-0000-0000-00000000000a', $$update users set password_hash = 'x' where username = 'ann'$$, 'permission denied');
select ok(rows_as('authenticated', '00000000-0000-0000-0000-00000000000a', $$update users set avatar = '🏆' where username = 'ann' returning 1$$) = 1, 'ann can set her own avatar');
select ok(rows_as('authenticated', '00000000-0000-0000-0000-00000000000a', $$update users set avatar = '💀' where username = 'bob' returning 1$$) = 0, 'ann cannot change bob''s avatar');
select ok((select avatar from users where username = 'bob') is null, 'bob''s avatar untouched');

-- ── Groups and joining ────────────────────────────────────────────────────────
select ok(rows_as('authenticated', '00000000-0000-0000-0000-00000000000a', 'select * from groups') = 1, 'ann sees only her group');
select ok(rows_as('authenticated', '00000000-0000-0000-0000-00000000000a', 'select * from memberships') = 2, 'ann sees only her group''s members');
select denied('authenticated', '00000000-0000-0000-0000-00000000000a', $$insert into groups(name, invite_code) values ('Sneaky','SNEAKY01')$$, 'row-level security');
select denied('authenticated', '00000000-0000-0000-0000-00000000000a', $$insert into memberships values ('ann','10000000-0000-0000-0000-000000000002')$$, 'permission denied');
select denied('authenticated', '00000000-0000-0000-0000-00000000000a', $$select join_group('NOPE1234')$$, 'Invalid invite code');
select ok(rows_as('authenticated', '00000000-0000-0000-0000-00000000000a', $$select join_group('grouptwo')$$) = 1, 'a valid code (any case) joins');
select ok(exists (select 1 from memberships where username = 'ann' and group_id = '10000000-0000-0000-0000-000000000002'), 'ann is now in G2');
select ok(rows_as('authenticated', '00000000-0000-0000-0000-00000000000a', $$select join_group('GROUPTWO')$$) = 1, 'joining twice is harmless');
select ok(rows_as('authenticated', '00000000-0000-0000-0000-00000000000a', 'select * from groups') = 2, 'ann now sees both groups');

select as_('authenticated', '00000000-0000-0000-0000-00000000000b');
create temp table made as select * from create_group('Bobs Mob', '🍺');
select back();
select ok((select count(*) from made where created_by = 'bob' and invite_code ~ '^[A-Z2-9]{8}$') = 1, 'create_group makes a code and records the creator');
select ok(exists (select 1 from memberships m join made g on g.id = m.group_id where m.username = 'bob'), 'creator is the first member');
select ok(exists (select 1 from group_state s join made g on g.id = s.group_id), 'creator group has run state');
select as_('authenticated', '00000000-0000-0000-0000-00000000000b'); select create_group('Two',''); select create_group('Three',''); select back();
select denied('authenticated', '00000000-0000-0000-0000-00000000000b', $$select create_group('Four','')$$, 'Group limit reached');
select denied('authenticated', '00000000-0000-0000-0000-00000000000b', $$select create_group('Five','')$$, 'Group limit reached');

-- ── Entries: write your own, read others only after lock ─────────────────────
select ok(rows_as('authenticated', '00000000-0000-0000-0000-00000000000a', $$insert into submissions(username, entry_name, preds, group_id) values ('ann','Entry 1','{"0":"home","1":"home","2":"home","3":"home","4":"home"}','10000000-0000-0000-0000-000000000001') returning 1$$) = 1, 'ann can enter');
select denied('authenticated', '00000000-0000-0000-0000-00000000000a', $$insert into submissions(username, entry_name, preds, group_id) values ('bob','Entry 9','{"0":"home","1":"home","2":"home","3":"home","4":"home"}','10000000-0000-0000-0000-000000000001')$$, 'row-level security');
select ok(rows_as('authenticated', '00000000-0000-0000-0000-00000000000b', $$insert into submissions(username, entry_name, preds, group_id) values ('bob','Entry 1','{"0":"away","1":"away","2":"away","3":"away","4":"away"}','10000000-0000-0000-0000-000000000001') returning 1$$) = 1, 'bob can enter');
select ok(rows_as('authenticated', '00000000-0000-0000-0000-00000000000a', 'select * from submissions') = 1, 'ann can read only her own rows directly');

select as_('authenticated', '00000000-0000-0000-0000-00000000000a');
create temp table before_lock as select * from group_entries('10000000-0000-0000-0000-000000000001');
select back();
select ok((select count(*) from before_lock) = 2, 'ann sees that both entries exist');
select ok((select preds from before_lock where username = 'ann') ? '0', 'ann sees her own picks');
select ok((select preds from before_lock where username = 'bob') = '{}'::jsonb, 'bob''s picks are hidden before lock');
select denied('authenticated', '00000000-0000-0000-0000-00000000000c', $$select * from group_entries('10000000-0000-0000-0000-000000000001')$$, 'Not a member');

update round set fixtures = (select jsonb_agg(jsonb_build_object('kickoffTs', ms(-60 + i))) from generate_series(0,4) i) where id = 1;   -- kick-off has passed
select as_('authenticated', '00000000-0000-0000-0000-00000000000a');
create temp table after_lock as select * from group_entries('10000000-0000-0000-0000-000000000001');
select back();
select ok((select preds from after_lock where username = 'bob') ? '0', 'bob''s picks are visible once locked');
update round set fixtures = (select jsonb_agg(jsonb_build_object('kickoffTs', ms(180 + i))) from generate_series(0,4) i) where id = 1;

-- ── The round ─────────────────────────────────────────────────────────────────
select ok(rows_as('authenticated', '00000000-0000-0000-0000-00000000000a', 'select * from round') = 1, 'players can read the round');
select denied('authenticated', '00000000-0000-0000-0000-00000000000a', $$update round set results = '[]'::jsonb where id = 1$$, 'Only the admin');
select denied('authenticated', '00000000-0000-0000-0000-00000000000a', $$update round set fixtures = '[]'::jsonb, locked = true where id = 1$$, 'Only the admin');
select ok(rows_as('authenticated', '00000000-0000-0000-0000-00000000000a', $$delete from round returning 1$$) = 0, 'players cannot delete the round');
select ok(rows_as('authenticated', '00000000-0000-0000-0000-00000000000a', $$update round set locked = true where id = 1 returning 1$$) = 1, 'a player may lock the round');
select denied('authenticated', '00000000-0000-0000-0000-00000000000a', $$update round set locked = false where id = 1$$, 'Only the admin');
select ok(rows_as('authenticated', '00000000-0000-0000-0000-00000000000d', $$update round set locked = false, results = '[]'::jsonb where id = 1 returning 1$$) = 1, 'the admin may change anything');
select ok(rows_as('authenticated', '00000000-0000-0000-0000-00000000000d', $$delete from submissions where username = 'bob' returning 1$$) = 1, 'the admin may clear entries');
select ok(rows_as('authenticated', '00000000-0000-0000-0000-00000000000a', $$delete from submissions returning 1$$) = 0, 'players cannot delete entries');

-- ── Winner / run status and history ──────────────────────────────────────────
select ok(rows_as('authenticated', '00000000-0000-0000-0000-00000000000a', $$update group_state set winners_found = true where group_id = '10000000-0000-0000-0000-000000000001' returning 1$$) = 1, 'a member can mark winners found');
select ok(rows_as('authenticated', '00000000-0000-0000-0000-00000000000a', $$update group_state set winners_found = true where group_id = '10000000-0000-0000-0000-000000000002' returning 1$$) = 1, 'ann joined G2 earlier, so she can');
select ok(rows_as('authenticated', '00000000-0000-0000-0000-00000000000b', $$update group_state set winners_found = false where group_id = '10000000-0000-0000-0000-000000000002' returning 1$$) = 0, 'bob is not in G2');
select denied('authenticated', '00000000-0000-0000-0000-00000000000a', $$update group_state set series = 9 where group_id = '10000000-0000-0000-0000-000000000001'$$, 'permission denied');
select ok(rows_as('authenticated', '00000000-0000-0000-0000-00000000000b', 'select * from history') = 1, 'bob sees only his group''s history');
select denied('authenticated', '00000000-0000-0000-0000-00000000000b', $$insert into history(group_id, series, week, username, entry_name, preds, correct, total, perfect) values ('10000000-0000-0000-0000-000000000001',1,2,'bob','x','{}',5,5,true)$$, 'permission denied');

-- ── Feedback and password resets ─────────────────────────────────────────────
select ok(rows_as('authenticated', '00000000-0000-0000-0000-00000000000a', $$insert into feedback(username, group_id, category, message) values ('ann','10000000-0000-0000-0000-000000000001','idea','more cowbell') returning 1$$) = 1, 'ann can send feedback');
select denied('authenticated', '00000000-0000-0000-0000-00000000000a', $$insert into feedback(username, group_id, category, message) values ('bob','10000000-0000-0000-0000-000000000001','idea','as bob')$$, 'row-level security');
select ok(rows_as('authenticated', '00000000-0000-0000-0000-00000000000a', 'select * from feedback') = 0, 'players cannot read feedback');
select ok(rows_as('authenticated', '00000000-0000-0000-0000-00000000000d', 'select * from feedback') = 1, 'the admin reads feedback');

select works('anon', null, $$insert into reset_requests(username, note) values ('dave', 'friend of Ann')$$);   -- no RETURNING: signed-out players cannot read the table
select denied('anon', null, $$insert into reset_requests(username) values ('DAVE')$$, 'Already requested');
select denied('anon', null, $$insert into reset_requests(username, note) values ('eve', repeat('x', 400))$$, 'Note too long');
select denied('anon', null, 'select * from reset_requests', 'permission denied');
select ok(rows_as('authenticated', '00000000-0000-0000-0000-00000000000a', 'select * from reset_requests') = 0, 'players cannot read reset requests');
select ok(rows_as('authenticated', '00000000-0000-0000-0000-00000000000d', 'select * from reset_requests') = 1, 'the admin sees reset requests');
select ok(rows_as('authenticated', '00000000-0000-0000-0000-00000000000d', $$update reset_requests set status = 'done' returning 1$$) = 1, 'the admin can close a request');

-- ── Admin-only powers ─────────────────────────────────────────────────────────
select ok(rows_as('authenticated', '00000000-0000-0000-0000-00000000000d', 'select * from groups') = (select count(*) from groups), 'the admin sees every group');
select ok(rows_as('authenticated', '00000000-0000-0000-0000-00000000000d', $$insert into groups(name, invite_code) values ('Mates','MATES2026') returning 1$$) = 1, 'the admin can create a group with any code');
select ok(rows_as('authenticated', '00000000-0000-0000-0000-00000000000d', $$update groups set emoji = '🏆' where invite_code = 'MATES2026' returning 1$$) = 1, 'the admin can set a badge');
select ok(rows_as('authenticated', '00000000-0000-0000-0000-00000000000a', $$update groups set emoji = '💀' where invite_code = 'GROUPONE' returning 1$$) = 0, 'players cannot');

-- ── Handles must match the JavaScript version ────────────────────────────────
select ok(handle_for('MarkMolo') = 'markmolo', 'plain');
select ok(handle_for('ogorki jafar') = 'ogorki-s-jafar', 'space');
select ok(handle_for('A_b.c-d') = 'a-u-b-d-c-h-d', 'punctuation');
select ok(handle_for('Zoë') = 'zo-xc3ab-', 'non-ASCII');
select ok(handle_for('a b') <> handle_for('a-b') and handle_for('a-b') <> handle_for('a_b'), 'different names never collide');

rollback;
\echo ALL AUTH SQL TESTS PASSED
