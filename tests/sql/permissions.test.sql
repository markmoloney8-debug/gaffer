-- Who-can-do-what matrix, run against the real policies and triggers.
-- Needs baseline.sql, history-setup.sql, hardening.sql, auth-stub.sql and auth.sql applied.
-- Roles: signed-out (anon), player in G1 (bob), player in another group (carl), admin (mark).
-- Every row below is one permission decision. If someone changes a policy, a row here should change with it.
-- Outcomes: ALLOWED = statement succeeds and touches >=1 row; NOROWS = succeeds but policy hides every row;
--           DENIED = statement is refused with an error.
begin;

create function as_(sub text, r text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(sub, ''), true);
  execute 'set local role ' || r;
end $$;
create function back() returns void language plpgsql as $$ begin execute 'reset role'; perform set_config('request.jwt.claim.sub', '', true); end $$;

create temp table cases(n serial, who text, what text, stmt text, expect text, setup text);
create temp table failures(msg text);

-- Run a statement as a person and say what happened.
create function outcome(who text, stmt text) returns text language plpgsql as $$
declare n bigint; sub text; r text;
begin
  select case who when 'anon' then null when 'bob' then '00000000-0000-0000-0000-00000000000b'
                  when 'carl' then '00000000-0000-0000-0000-00000000000c' when 'mark' then '00000000-0000-0000-0000-00000000000d' end,
         case who when 'anon' then 'anon' else 'authenticated' end into sub, r;
  perform as_(sub, r);
  begin
    if stmt ~* '^\s*(select|insert|update|delete)' and stmt ~* 'returning|^\s*select' then
      execute 'with q as (' || stmt || ') select count(*) from q' into n;
    else
      execute stmt; n := 1;
    end if;
  exception when others then
    perform back(); return 'DENIED';
  end;
  perform back();
  return case when n > 0 then 'ALLOWED' else 'NOROWS' end;
end $$;

insert into users(username, handle, auth_id) values
  ('bob',  'bob',  '00000000-0000-0000-0000-00000000000b'),
  ('carl', 'carl', '00000000-0000-0000-0000-00000000000c'),
  ('mark', 'mark', '00000000-0000-0000-0000-00000000000d');
insert into admins values ('mark');
insert into groups(id, name, invite_code) values
  ('10000000-0000-0000-0000-000000000001', 'G1', 'GROUPONE'),
  ('10000000-0000-0000-0000-000000000002', 'G2', 'GROUPTWO');
insert into group_state(group_id) values ('10000000-0000-0000-0000-000000000001'), ('10000000-0000-0000-0000-000000000002') on conflict do nothing;
insert into memberships values ('bob','10000000-0000-0000-0000-000000000001'), ('carl','10000000-0000-0000-0000-000000000002');

create function set_round(is_locked boolean, kickoff_min int) returns void language sql as $$
  delete from round;
  insert into round(id, league, fixtures, results, week, locked)
  values (1, '{}', (select jsonb_agg(jsonb_build_object('kickoffTs', ((extract(epoch from now()) + (kickoff_min + i) * 60) * 1000)::bigint)) from generate_series(0,4) i),
          '[{"result":"home"}]'::jsonb, 1, is_locked);
$$;

-- ── 1. Signed out can touch nothing ──────────────────────────────────────────
insert into cases(who, what, stmt, expect, setup)
select 'anon', 'read ' || t, 'select * from ' || t, 'DENIED', 'open'
from unnest(array['users','groups','submissions','round','memberships','history','feedback','reset_requests','group_state','admins']) t;
insert into cases(who, what, stmt, expect, setup) values
 ('anon', 'join a group',   $$select join_group('GROUPONE')$$, 'DENIED', 'open'),
 ('anon', 'create a group', $$select create_group('X','')$$,   'DENIED', 'open'),
 ('anon', 'read group entries', $$select * from group_entries('10000000-0000-0000-0000-000000000001')$$, 'DENIED', 'open'),
 ('anon', 'ask for a password reset', $$insert into reset_requests(username, note) values ('zed','hi')$$, 'ALLOWED', 'open');

-- ── 2. The round, in every state a round can be in ───────────────────────────
-- setup names: open (before kick-off, unlocked), live (kicked off, unlocked), locked (locked flag already true)
insert into cases(who, what, stmt, expect, setup) values
 ('bob',  'read the round',                       'select * from round',                                     'ALLOWED', 'open'),
 ('carl', 'read the round',                       'select * from round',                                     'ALLOWED', 'open'),
 ('bob',  'lock an unlocked round',               'update round set locked = true where id = 1 returning 1', 'ALLOWED', 'live'),
 ('carl', 'lock an unlocked round',               'update round set locked = true where id = 1 returning 1', 'ALLOWED', 'live'),
 ('bob',  'lock AGAIN when already locked',       'update round set locked = true where id = 1 returning 1', 'DENIED',  'locked'),   -- the Andrew bug: the app must never try this
 ('carl', 'lock AGAIN when already locked',       'update round set locked = true where id = 1 returning 1', 'DENIED',  'locked'),
 ('mark', 'lock AGAIN when already locked',       'update round set locked = true where id = 1 returning 1', 'ALLOWED', 'locked'),
 ('bob',  'unlock the round',                     'update round set locked = false where id = 1',            'DENIED',  'locked'),
 ('mark', 'unlock the round',                     'update round set locked = false where id = 1 returning 1','ALLOWED', 'locked'),
 ('bob',  'write results',                        $$update round set results = '[]'::jsonb where id = 1$$,   'DENIED',  'live'),
 ('bob',  'write results while locking',          $$update round set results = '[]'::jsonb, locked = true where id = 1$$, 'DENIED', 'live'),
 ('bob',  'change fixtures',                      $$update round set fixtures = '[]'::jsonb where id = 1$$,  'DENIED',  'live'),
 ('bob',  'change the week',                      'update round set week = 99 where id = 1',                 'DENIED',  'live'),
 ('mark', 'write results',                        $$update round set results = '[]'::jsonb where id = 1 returning 1$$, 'ALLOWED', 'live'),
 ('mark', 'change fixtures',                      $$update round set fixtures = '[]'::jsonb where id = 1 returning 1$$, 'ALLOWED', 'live'),
 ('bob',  'delete the round',                     'delete from round returning 1',                           'NOROWS',  'live'),
 ('bob',  'insert a second round',                $$insert into round(id, league, fixtures, week) values (2,'{}','[]',1)$$, 'DENIED', 'live'),
 ('mark', 'delete the round',                     'delete from round returning 1',                           'ALLOWED', 'live');

-- ── 3. Entries: own vs other people's, before and after kick-off ─────────────
insert into cases(who, what, stmt, expect, setup) values
 ('bob',  'add my own entry before kick-off',     $$insert into submissions(username, entry_name, preds, group_id) values ('bob','Entry 2','{"0":"home","1":"home","2":"home","3":"home","4":"home"}','10000000-0000-0000-0000-000000000001')$$, 'ALLOWED', 'open'),
 ('bob',  'add an entry as someone else',         $$insert into submissions(username, entry_name, preds, group_id) values ('carl','Entry 2','{"0":"home","1":"home","2":"home","3":"home","4":"home"}','10000000-0000-0000-0000-000000000001')$$, 'DENIED', 'open'),
 ('bob',  'read other people''s entries directly','select * from submissions where username = ''carl''',   'NOROWS', 'open'),
 ('mark', 'read everyone''s entries directly',    'select * from submissions',                              'ALLOWED', 'open'),
 ('bob',  'edit my own entry',                    $$update submissions set preds = '{"0":"away","1":"away","2":"away","3":"away","4":"away"}' where username = 'bob' returning 1$$, 'ALLOWED', 'open'),
 ('bob',  'edit someone else''s entry',           $$update submissions set preds = '{"0":"away","1":"away","2":"away","3":"away","4":"away"}' where username = 'carl' returning 1$$, 'NOROWS', 'open'),
 ('bob',  'delete my own entry before kick-off',  $$delete from submissions where username = 'bob' returning 1$$, 'ALLOWED', 'open'),
 ('bob',  'delete my own entry after kick-off',   $$delete from submissions where username = 'bob' returning 1$$, 'NOROWS', 'live'),
 ('bob',  'delete someone else''s entry',         $$delete from submissions where username = 'carl' returning 1$$, 'NOROWS', 'open'),
 ('mark', 'delete anyone''s entry, any time',     $$delete from submissions where username = 'carl' returning 1$$, 'ALLOWED', 'live'),
 ('bob',  'list entries of my own group',         $$select * from group_entries('10000000-0000-0000-0000-000000000001')$$, 'ALLOWED', 'open'),
 ('carl', 'list entries of a group I am not in',  $$select * from group_entries('10000000-0000-0000-0000-000000000001')$$, 'DENIED', 'open'),
 ('mark', 'list entries of any group',            $$select * from group_entries('10000000-0000-0000-0000-000000000002')$$, 'ALLOWED', 'open');

-- ── 4. Groups, membership, winners, history ──────────────────────────────────
insert into cases(who, what, stmt, expect, setup) values
 ('bob',  'see my group',                         'select * from groups where id = ''10000000-0000-0000-0000-000000000001''', 'ALLOWED', 'open'),
 ('bob',  'see a group I am not in',              'select * from groups where id = ''10000000-0000-0000-0000-000000000002''', 'NOROWS',  'open'),
 ('mark', 'see any group',                        'select * from groups where id = ''10000000-0000-0000-0000-000000000002''', 'ALLOWED', 'open'),
 ('bob',  'insert a group directly',              $$insert into groups(name, invite_code) values ('S','SNEAKY01')$$, 'DENIED', 'open'),
 ('bob',  'give myself a membership directly',    $$insert into memberships values ('bob','10000000-0000-0000-0000-000000000002')$$, 'DENIED', 'open'),
 ('bob',  'join with a valid code',               $$select join_group('GROUPTWO')$$, 'ALLOWED', 'open'),
 ('bob',  'join with a wrong code',               $$select join_group('NOPE0000')$$, 'DENIED',  'open'),
 ('bob',  'mark winners in my group',             $$update group_state set winners_found = true where group_id = '10000000-0000-0000-0000-000000000001' returning 1$$, 'ALLOWED', 'open'),
 ('bob',  'mark winners in another group',        $$update group_state set winners_found = true where group_id = '10000000-0000-0000-0000-000000000002' returning 1$$, 'NOROWS',  'open'),
 ('bob',  'change the series number',             $$update group_state set series = 9 where group_id = '10000000-0000-0000-0000-000000000001'$$, 'DENIED', 'open'),
 ('bob',  'read my group''s history',             'select * from history where group_id = ''10000000-0000-0000-0000-000000000001''', 'NOROWS', 'open'),   -- empty table here; the point is no error
 ('bob',  'write history',                        $$insert into history(group_id, series, week, username, entry_name, preds, correct, total, perfect) values ('10000000-0000-0000-0000-000000000001',1,1,'bob','E','{}',1,5,false)$$, 'DENIED', 'open'),
 ('mark', 'write history',                        $$insert into history(group_id, series, week, username, entry_name, preds, correct, total, perfect) values ('10000000-0000-0000-0000-000000000001',1,1,'bob','E','{}',1,5,false) returning 1$$, 'DENIED', 'open');  -- history is written by the scheduled job (service key), not by any signed-in user

-- ── 5. Profiles, feedback, password resets, admin list ───────────────────────
insert into cases(who, what, stmt, expect, setup) values
 ('bob',  'change my avatar',                     $$update users set avatar = 'x' where username = 'bob' returning 1$$, 'ALLOWED', 'open'),
 ('bob',  'change someone else''s avatar',        $$update users set avatar = 'x' where username = 'carl' returning 1$$, 'NOROWS', 'open'),
 ('bob',  'read password hashes',                 'select password_hash from users', 'DENIED', 'open'),
 ('bob',  'read auth ids',                        'select auth_id from users',       'DENIED', 'open'),
 ('bob',  'make myself admin',                    $$insert into admins values ('bob')$$, 'DENIED', 'open'),
 ('mark', 'make someone else admin',              $$insert into admins values ('carl')$$, 'DENIED', 'open'),   -- admins are added in SQL by the owner, never from the app
 ('bob',  'read the admin list',                  'select * from admins', 'DENIED', 'open'),
 ('bob',  'send feedback as myself',              $$insert into feedback(username, group_id, category, message) values ('bob','10000000-0000-0000-0000-000000000001','idea','hi') returning 1$$, 'ALLOWED', 'open'),
 ('bob',  'send feedback as someone else',        $$insert into feedback(username, group_id, category, message) values ('carl','10000000-0000-0000-0000-000000000001','idea','hi')$$, 'DENIED', 'open'),
 ('bob',  'read feedback',                        'select * from feedback', 'NOROWS', 'open'),
 ('mark', 'read feedback',                        'select * from feedback', 'ALLOWED', 'open'),
 ('bob',  'read reset requests',                  'select * from reset_requests', 'NOROWS', 'open'),
 ('mark', 'read reset requests',                  'select * from reset_requests', 'ALLOWED', 'open'),
 ('bob',  'close a reset request',                $$update reset_requests set status = 'done' returning 1$$, 'NOROWS', 'open'),
 ('mark', 'close a reset request',                $$update reset_requests set status = 'done' returning 1$$, 'ALLOWED', 'open');

-- ── Run the matrix ───────────────────────────────────────────────────────────
-- Fresh data before every row so rows cannot affect each other.
create function reseed(setup text) returns void language plpgsql as $$
begin
  delete from submissions; delete from feedback; delete from reset_requests;
  update group_state set winners_found = false, series = 1;
  delete from memberships where username = 'bob' and group_id = '10000000-0000-0000-0000-000000000002';
  update users set avatar = null;
  perform set_round(false, 120);
  insert into submissions(username, entry_name, preds, group_id) values
    ('bob','Entry 1','{"0":"home","1":"home","2":"home","3":"home","4":"home"}','10000000-0000-0000-0000-000000000001'),
    ('carl','Entry 1','{"0":"home","1":"home","2":"home","3":"home","4":"home"}','10000000-0000-0000-0000-000000000002');
  if setup = 'live'   then perform set_round(false, -30);
  elsif setup = 'locked' then perform set_round(true, -30);
  end if;
  insert into feedback(username, group_id, category, message) values ('carl','10000000-0000-0000-0000-000000000002','idea','seed');
  insert into reset_requests(username, note) values ('seed', 'seed');
end $$;

do $$
declare c record; got text; bad int := 0;
begin
  for c in select * from cases order by n loop
    perform reseed(c.setup);
    got := outcome(c.who, c.stmt);
    if got <> c.expect then
      bad := bad + 1;
      raise warning 'MISMATCH #%: % — %: expected %, got %', c.n, c.who, c.what, c.expect, got;
    end if;
  end loop;
  if bad > 0 then raise exception '% permission rows did not behave as the matrix says', bad; end if;
  raise notice '% permission decisions checked', (select count(*) from cases);
end $$;

rollback;
\echo ALL PERMISSION MATRIX TESTS PASSED
