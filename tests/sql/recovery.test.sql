-- Behaviour tests for auth/recovery.sql. Needs everything auth.test.sql needs, plus recovery.sql applied.
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


insert into users(username, handle, auth_id) values
  ('rann', 'rann', '00000000-0000-0000-0000-0000000000a1'),
  ('rbob', 'rbob', '00000000-0000-0000-0000-0000000000b1'),
  ('rmark','rmark','00000000-0000-0000-0000-0000000000d1');
insert into admins values ('rmark');
insert into groups(id, name, invite_code) values ('10000000-0000-0000-0000-0000000000f1', 'RG', 'RGROUP01');
insert into memberships values ('rann','10000000-0000-0000-0000-0000000000f1'), ('rbob','10000000-0000-0000-0000-0000000000f1');
update users set recovery_email = 'v1.aXY.Y3Q', recovery_hint = 'a****@example.com', recovery_verified_at = now() where username = 'rann';   -- done by the account function

-- Nobody can read a recovery email through the app: not other players, not the player's own row, not the admin
select denied('authenticated', '00000000-0000-0000-0000-0000000000b1', 'select recovery_email from users', 'permission denied');
select denied('authenticated', '00000000-0000-0000-0000-0000000000a1', 'select recovery_email from users', 'permission denied');
select denied('authenticated', '00000000-0000-0000-0000-0000000000d1', 'select recovery_email from users', 'permission denied');
select denied('authenticated', '00000000-0000-0000-0000-0000000000a1', 'select recovery_verified_at from users', 'permission denied');
select denied('authenticated', '00000000-0000-0000-0000-0000000000b1', 'select recovery_hint from users', 'permission denied');
select denied('authenticated', '00000000-0000-0000-0000-0000000000b1', 'select * from users', 'permission denied');
select denied('anon', null, 'select recovery_email from users', 'permission denied');

-- ...and nobody can set or verify one by writing to the table directly (a verified address is the key to the account)
select denied('authenticated', '00000000-0000-0000-0000-0000000000b1', $$update users set recovery_email = 'evil@example.com' where username = 'rbob'$$, 'permission denied');
select denied('authenticated', '00000000-0000-0000-0000-0000000000b1', $$update users set recovery_verified_at = now() where username = 'rbob'$$, 'permission denied');
select denied('authenticated', '00000000-0000-0000-0000-0000000000b1', $$update users set recovery_email = 'evil@example.com' where username = 'rann'$$, 'permission denied');

-- A player sees only their own address, through my_recovery()
select as_('authenticated', '00000000-0000-0000-0000-0000000000a1');
select ok((select email from my_recovery()) = 'a****@example.com' and (select verified from my_recovery()), 'ann sees only the masked version of her confirmed address');
select back();
select as_('authenticated', '00000000-0000-0000-0000-0000000000b1');
select ok((select count(*) from my_recovery() where email is not null) = 0, 'bob sees no address');
select back();
select denied('anon', null, 'select * from my_recovery()', 'permission denied');

-- The token table is closed to the app completely
insert into auth_tokens(username, purpose, token_hash, expires_at) values ('rann', 'reset', 'h1', now() + interval '30 minutes');
select denied('authenticated', '00000000-0000-0000-0000-0000000000a1', 'select * from auth_tokens', 'permission denied');
select denied('authenticated', '00000000-0000-0000-0000-0000000000d1', 'select * from auth_tokens', 'permission denied');
select denied('authenticated', '00000000-0000-0000-0000-0000000000a1', $$insert into auth_tokens(username, purpose, token_hash, expires_at) values ('rann','reset','h2', now() + interval '1 day')$$, 'permission denied');
select denied('anon', null, 'select * from auth_tokens', 'permission denied');
select denied('anon', null, $$delete from auth_tokens$$, 'permission denied');

-- Constraints: bad addresses are refused, a token hash can't repeat, purposes are limited
do $$ begin
    begin update users set recovery_email = repeat('a', 700) where username = 'rbob'; raise exception 'should have failed'; exception when check_violation then null; end;
  begin insert into auth_tokens(username, purpose, token_hash, expires_at) values ('rann','reset','h1', now()); raise exception 'should have failed'; exception when unique_violation then null; end;
  begin insert into auth_tokens(username, purpose, token_hash, expires_at) values ('rann','login','h3', now()); raise exception 'should have failed'; exception when check_violation then null; end;
end $$;

-- Deleting a player removes their tokens
delete from users where username = 'rbob';
select ok((select count(*) from auth_tokens where username = 'rbob') = 0, 'tokens go with the player');

\echo ALL RECOVERY SQL TESTS PASSED
rollback;
