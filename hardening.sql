-- hardening.sql
-- Run once in the Supabase SQL editor, AFTER history-setup.sql.
-- These rules are enforced by the database itself, so they hold even if somebody
-- skips the app and calls the API directly with the public key.
--
-- What it enforces
--   * An entry can only be saved by a member of that group.
--   * Max 5 entries per player per group per round.
--   * No new entries once the first kick-off is within 1 minute (a real server-side lock).
--   * Every entry must have a valid pick (home/draw/away) for all 5 matches.
--   * After saving, a pick can only change for a REPLACED fixture, and only until 1 minute before it kicks off.
--   * Max 30 players per group.
--   * Usernames are 2-20 characters.
-- What it can NOT enforce without real sign-in: pretending to be another username.

-- 1. Entries ---------------------------------------------------------------
create or replace function enforce_submission_rules() returns trigger
language plpgsql as $$
declare
  first_ko bigint;
  fx jsonb;
  k int;
  v text;
  now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from memberships m where m.username = new.username and m.group_id = new.group_id) then
      raise exception 'Not a member of this group';
    end if;

    if (select count(*) from submissions s
         where s.username = new.username and s.group_id = new.group_id) >= 5 then
      raise exception 'Entry limit reached (5 per round)';
    end if;

    select min((f->>'kickoffTs')::bigint) into first_ko
      from round r, jsonb_array_elements(r.fixtures) f where r.id = 1;
    if first_ko is not null and now_ms >= first_ko - 60000 then
      raise exception 'Entries are closed';
    end if;

    if new.preds is null or jsonb_typeof(new.preds) <> 'object' then
      raise exception 'Invalid predictions';
    end if;
    for k in 0..4 loop
      v := new.preds->>(k::text);
      if v is null or v not in ('home', 'draw', 'away') then
        raise exception 'Invalid predictions';
      end if;
    end loop;
    return new;
  end if;

  -- UPDATE
  if new.username <> old.username or new.group_id is distinct from old.group_id then
    raise exception 'An entry cannot be moved';
  end if;
  select fixtures into fx from round where id = 1;
  select min((f->>'kickoffTs')::bigint) into first_ko
    from round r, jsonb_array_elements(r.fixtures) f where r.id = 1;
  if new.preds is null or jsonb_typeof(new.preds) <> 'object' then
    raise exception 'Invalid predictions';
  end if;

  -- While entries are still open a player may change any pick on their own entry.
  -- (A pick may only be missing where the fixture has just been replaced and is waiting to be re-picked.)
  if first_ko is null or now_ms < first_ko - 60000 then
    for k in 0..4 loop
      v := new.preds->>(k::text);
      if v is null then
        if not coalesce((fx->k->>'replaced')::boolean, false) then
          raise exception 'Invalid predictions';
        end if;
      elsif v not in ('home', 'draw', 'away') then
        raise exception 'Invalid prediction';
      end if;
    end loop;
    return new;
  end if;

  -- Once entries have closed, only a replaced fixture can be re-picked, and only until it is about to kick off.
  for k in 0..4 loop
    if (new.preds->>(k::text)) is distinct from (old.preds->>(k::text)) then
      if not coalesce((fx->k->>'replaced')::boolean, false) then
        raise exception 'This pick can no longer be changed';
      end if;
      if (new.preds->>(k::text)) is not null then
        if (new.preds->>(k::text)) not in ('home', 'draw', 'away') then
          raise exception 'Invalid prediction';
        end if;
        if (fx->k->>'kickoffTs')::bigint - 60000 <= now_ms then
          raise exception 'Too late to re-pick this match';
        end if;
      end if;
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists submissions_rules on submissions;
create trigger submissions_rules before insert or update on submissions
  for each row execute function enforce_submission_rules();

-- 2. Group size ------------------------------------------------------------
create or replace function enforce_group_size() returns trigger
language plpgsql as $$
begin
  if (select count(*) from memberships where group_id = new.group_id) >= 30 then
    raise exception 'This group is full (30 players)';
  end if;
  return new;
end $$;

drop trigger if exists memberships_size on memberships;
create trigger memberships_size before insert on memberships
  for each row execute function enforce_group_size();

alter table memberships drop constraint if exists memberships_username_fkey;
alter table memberships add constraint memberships_username_fkey
  foreign key (username) references users(username) on delete cascade;

-- 3. Usernames and password hashes (applies to new rows) -------------------
alter table users drop constraint if exists users_username_len;
alter table users add constraint users_username_len
  check (char_length(username) between 2 and 20) not valid;
alter table users drop constraint if exists users_hash_format;
alter table users add constraint users_hash_format
  check (password_hash ~ '^[0-9a-f]{64}$') not valid;

-- 4. Avatars and group badges (applies to new rows) ------------------------
alter table users drop constraint if exists users_avatar_len;
alter table users add constraint users_avatar_len check (avatar is null or char_length(avatar) <= 8) not valid;
alter table users drop constraint if exists users_avatar_color_fmt;
alter table users add constraint users_avatar_color_fmt check (avatar_color is null or avatar_color ~ '^#[0-9a-fA-F]{6}$') not valid;
alter table groups drop constraint if exists groups_emoji_len;
alter table groups add constraint groups_emoji_len check (emoji is null or char_length(emoji) <= 8) not valid;

-- 5. Feedback: size, category and a rate limit (one message per player per 2 minutes) --
create or replace function enforce_feedback_rules() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.category not in ('bug', 'idea', 'other') then raise exception 'Invalid category'; end if;
    if new.message is null or char_length(btrim(new.message)) = 0 then raise exception 'Message is empty'; end if;
    if char_length(new.message) > 1000 then raise exception 'Message is too long'; end if;
    if exists (select 1 from feedback f where f.username = new.username and f.created_at > now() - interval '2 minutes') then
      raise exception 'Please wait a couple of minutes before sending more feedback';
    end if;
    new.status := 'new';
    new.issue_url := null;
    return new;
  end if;
  -- UPDATE: only the status and the issue link may change
  if new.message is distinct from old.message or new.username is distinct from old.username
     or new.category is distinct from old.category then
    raise exception 'Feedback text cannot be edited';
  end if;
  return new;
end $$;

drop trigger if exists feedback_rules on feedback;
create trigger feedback_rules before insert or update on feedback
  for each row execute function enforce_feedback_rules();

-- ─── Player-created groups: name/code format and a per-creator limit ───────────
create or replace function groups_rules() returns trigger language plpgsql as $$
begin
  if char_length(new.name) < 2 or char_length(new.name) > 30 then
    raise exception 'Group name must be 2-30 characters';
  end if;
  if new.invite_code !~ '^[A-Z0-9]{4,24}$' then
    raise exception 'Invite code must be 4-24 letters or numbers';
  end if;
  if new.created_by is not null
     and (select count(*) from groups where created_by = new.created_by) >= 3 then
    raise exception 'Group limit reached (3 per player)';
  end if;
  return new;
end $$;
drop trigger if exists groups_rules on groups;
create trigger groups_rules before insert on groups for each row execute function groups_rules();
