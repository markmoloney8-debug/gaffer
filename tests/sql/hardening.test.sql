-- Behaviour tests for hardening.sql. Run with psql -v ON_ERROR_STOP=1 against a scratch database
-- that already has baseline.sql, history-setup.sql and hardening.sql applied. Any failure aborts.
begin;

create function expect_error(stmt text, pattern text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlerrm like '%' || pattern || '%' then return; end if;
    raise exception 'wrong error for [%]: got [%], wanted [%]', stmt, sqlerrm, pattern;
  end;
  raise exception 'expected an error containing [%] but statement succeeded: %', pattern, stmt;
end $$;

create function ms(offset_minutes int) returns bigint language sql as $$
  select ((extract(epoch from now()) + offset_minutes * 60) * 1000)::bigint $$;

-- Fixture set: first kick-off in 2 hours; fixture #3 (index 2) is a replacement kicking off in 5 hours.
insert into round(id, league, fixtures, week, locked, winners_found) values (1, '{}',
  jsonb_build_array(
    jsonb_build_object('kickoffTs', ms(120)), jsonb_build_object('kickoffTs', ms(180)),
    jsonb_build_object('kickoffTs', ms(300), 'replaced', true),
    jsonb_build_object('kickoffTs', ms(200)), jsonb_build_object('kickoffTs', ms(210))), 1, false, false);

insert into users values ('ann', repeat('a', 64)), ('bob', repeat('b', 64));
insert into groups(id, name, invite_code) values
  ('00000000-0000-0000-0000-000000000001', 'G1', 'CODE1'),
  ('00000000-0000-0000-0000-000000000002', 'G2', 'CODE2');
insert into memberships(username, group_id) values
  ('ann', '00000000-0000-0000-0000-000000000001');

-- 1. A member can enter; a non-member cannot
insert into submissions(username, entry_name, preds, group_id) values
  ('ann', 'Entry 1', '{"0":"home","1":"draw","2":"away","3":"home","4":"home"}', '00000000-0000-0000-0000-000000000001');
select expect_error($$insert into submissions(username, entry_name, preds, group_id) values
  ('ann', 'x', '{"0":"home","1":"draw","2":"away","3":"home","4":"home"}', '00000000-0000-0000-0000-000000000002')$$,
  'Not a member');
select expect_error($$insert into submissions(username, entry_name, preds, group_id) values
  ('bob', 'x', '{"0":"home","1":"draw","2":"away","3":"home","4":"home"}', '00000000-0000-0000-0000-000000000001')$$,
  'Not a member');

-- 2. Max 5 entries per player per group
insert into submissions(username, entry_name, preds, group_id)
  select 'ann', 'Entry ' || n, '{"0":"away","1":"away","2":"away","3":"away","4":"away"}', '00000000-0000-0000-0000-000000000001'
  from generate_series(2, 5) n;
select expect_error($$insert into submissions(username, entry_name, preds, group_id) values
  ('ann', 'Entry 6', '{"0":"home","1":"draw","2":"away","3":"home","4":"home"}', '00000000-0000-0000-0000-000000000001')$$,
  'Entry limit');

-- 3. The limit is per group: joining a second group gives a fresh 5
insert into memberships(username, group_id) values ('ann', '00000000-0000-0000-0000-000000000002');
insert into submissions(username, entry_name, preds, group_id) values
  ('ann', 'Entry 1', '{"0":"home","1":"home","2":"home","3":"home","4":"home"}', '00000000-0000-0000-0000-000000000002');

-- 4. Invalid or incomplete picks are rejected
delete from submissions where group_id = '00000000-0000-0000-0000-000000000002';
select expect_error($$insert into submissions(username, entry_name, preds, group_id) values
  ('ann', 'x', '{"0":"home","1":"draw","2":"away","3":"home"}', '00000000-0000-0000-0000-000000000002')$$, 'Invalid predictions');
select expect_error($$insert into submissions(username, entry_name, preds, group_id) values
  ('ann', 'x', '{"0":"home","1":"draw","2":"away","3":"home","4":"banana"}', '00000000-0000-0000-0000-000000000002')$$, 'Invalid predictions');
select expect_error($$insert into submissions(username, entry_name, preds, group_id) values
  ('ann', 'x', '[]', '00000000-0000-0000-0000-000000000002')$$, 'Invalid predictions');

-- 5. A normal pick cannot be edited, but a replaced slot can be re-picked
select expect_error($$update submissions set preds = jsonb_set(preds, '{0}', '"away"') where username='ann' and entry_name='Entry 1' and group_id='00000000-0000-0000-0000-000000000001'$$,
  'can no longer be changed');
update submissions set preds = preds - '2' where username='ann' and entry_name='Entry 1' and group_id='00000000-0000-0000-0000-000000000001';
update submissions set preds = jsonb_set(preds, '{2}', '"draw"') where username='ann' and entry_name='Entry 1' and group_id='00000000-0000-0000-0000-000000000001';
select expect_error($$update submissions set preds = jsonb_set(preds, '{2}', '"nonsense"') where username='ann' and entry_name='Entry 1' and group_id='00000000-0000-0000-0000-000000000001'$$,
  'Invalid prediction');
select expect_error($$update submissions set username='bob' where username='ann' and entry_name='Entry 1' and group_id='00000000-0000-0000-0000-000000000001'$$,
  'cannot be moved');

-- 6. Re-picking is refused once the replacement is about to kick off
update round set fixtures = jsonb_set(fixtures, '{2,kickoffTs}', to_jsonb(ms(0)));
select expect_error($$update submissions set preds = jsonb_set(preds - '2', '{2}', '"home"') where username='ann' and entry_name='Entry 2' and group_id='00000000-0000-0000-0000-000000000001'$$,
  'Too late to re-pick');  -- Entry 2 already has a pick on the replaced slot; changing it now is too late
update submissions set preds = preds - '2' where username='ann' and entry_name='Entry 3' and group_id='00000000-0000-0000-0000-000000000001'; -- clearing is always allowed
select expect_error($$update submissions set preds = jsonb_set(preds, '{2}', '"home"') where username='ann' and entry_name='Entry 3' and group_id='00000000-0000-0000-0000-000000000001'$$,
  'Too late to re-pick');
update round set fixtures = jsonb_set(fixtures, '{2,kickoffTs}', to_jsonb(ms(300)));

-- 7. No new entries inside the final minute before the first kick-off
delete from submissions;
update round set fixtures = jsonb_set(fixtures, '{0,kickoffTs}', to_jsonb(ms(0) + 30000));  -- kicks off in 30s
select expect_error($$insert into submissions(username, entry_name, preds, group_id) values
  ('ann', 'late', '{"0":"home","1":"draw","2":"away","3":"home","4":"home"}', '00000000-0000-0000-0000-000000000001')$$, 'Entries are closed');
update round set fixtures = jsonb_set(fixtures, '{0,kickoffTs}', to_jsonb(ms(5)));  -- 5 minutes away: still open
insert into submissions(username, entry_name, preds, group_id) values
  ('ann', 'ok', '{"0":"home","1":"draw","2":"away","3":"home","4":"home"}', '00000000-0000-0000-0000-000000000001');

-- 8. Group size cap of 30
insert into users select 'u' || n, repeat('c', 64) from generate_series(1, 40) n;
insert into memberships(username, group_id) select 'u' || n, '00000000-0000-0000-0000-000000000002' from generate_series(1, 29) n;
-- ann is already in group 2, so it now has 30 members
select expect_error($$insert into memberships(username, group_id) values ('u30', '00000000-0000-0000-0000-000000000002')$$, 'group is full');
insert into memberships(username, group_id) values ('u30', '00000000-0000-0000-0000-000000000001');  -- another group is unaffected

-- 9. Membership needs a real user; usernames and hashes are validated
select expect_error($$insert into memberships(username, group_id) values ('ghost', '00000000-0000-0000-0000-000000000001')$$, 'violates foreign key');
select expect_error($$insert into users values ('x', repeat('a', 64))$$, 'users_username_len');
select expect_error($$insert into users values (repeat('x', 21), repeat('a', 64))$$, 'users_username_len');
select expect_error($$insert into users values ('okname', 'plaintext')$$, 'users_hash_format');

-- 10. Avatars and group badges
select expect_error($$update users set avatar_color = 'red' where username = 'ann'$$, 'users_avatar_color_fmt');
select expect_error($$update users set avatar = repeat('x', 9) where username = 'ann'$$, 'users_avatar_len');
update users set avatar = '🦁', avatar_color = '#f0c040' where username = 'ann';
select expect_error($$update groups set emoji = repeat('x', 9) where invite_code = 'CODE1'$$, 'groups_emoji_len');
update groups set emoji = '🏆' where invite_code = 'CODE1';

-- 11. Feedback: valid, validated, rate limited, and not editable
insert into feedback(username, category, message) values ('ann', 'bug', 'The button is broken');
select expect_error($$insert into feedback(username, category, message) values ('ann', 'idea', 'Too soon')$$, 'Please wait');
insert into feedback(username, category, message) values ('bob', 'idea', 'Dark mode please');          -- a different player is fine
select expect_error($$insert into feedback(username, category, message) values ('cat', 'rant', 'x')$$, 'Invalid category');
select expect_error($$insert into feedback(username, category, message) values ('cat', 'bug', '   ')$$, 'Message is empty');
select expect_error($$insert into feedback(username, category, message) values ('cat', 'bug', repeat('x', 1001))$$, 'too long');
update feedback set status = 'done' where username = 'ann';                                              -- status can change
select expect_error($$update feedback set message = 'rewritten' where username = 'ann'$$, 'cannot be edited');
select expect_error($$update feedback set username = 'bob' where username = 'ann'$$, 'cannot be edited');
-- a new message cannot arrive pre-marked as sent
insert into feedback(username, category, message, status, issue_url, created_at) values ('cat', 'bug', 'sneaky', 'done', 'http://x', now() - interval '1 hour');
do $$ begin
  if (select status from feedback where message = 'sneaky') <> 'new' or (select issue_url from feedback where message = 'sneaky') is not null then
    raise exception 'new feedback must start as new with no issue link';
  end if;
end $$;

rollback;

-- ─── Player-created groups ─────────────────────────────────────────────────────
do $$
declare ok boolean;
begin
  insert into groups(name, invite_code, created_by) values ('Mine 1','MINE0001','zed'),('Mine 2','MINE0002','zed'),('Mine 3','MINE0003','zed');
  begin
    insert into groups(name, invite_code, created_by) values ('Mine 4','MINE0004','zed');
    raise exception 'FAIL: fourth own group was allowed';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    if sqlerrm not like '%Group limit%' then raise exception 'FAIL: wrong error %', sqlerrm; end if;
  end;
  begin
    insert into groups(name, invite_code) values ('x','GOODCODE');
    raise exception 'FAIL: 1-char name allowed';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin
    insert into groups(name, invite_code) values ('Okay','ab');
    raise exception 'FAIL: short/lowercase code allowed';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  -- admin-made groups (no creator) are not limited
  insert into groups(name, invite_code) values ('Admin A','ADMINAAA'),('Admin B','ADMINBBB'),('Admin C','ADMINCCC'),('Admin D','ADMINDDD');
  raise notice 'PASS: player-created group rules';
end $$;

\echo ALL SQL TESTS PASSED
