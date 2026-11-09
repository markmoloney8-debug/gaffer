-- Minimal copy of the original tables (what Supabase had before the group changes).
-- Used only by the SQL tests, which run against a scratch Postgres.
create table if not exists users(username text primary key, password_hash text, created_at timestamptz default now());
create table if not exists round(id int primary key, league jsonb, fixtures jsonb, mock_results jsonb, week int, locked bool, winners_found bool, created_at timestamptz default now(), results jsonb);
create table if not exists submissions(id uuid primary key default gen_random_uuid(), username text, entry_name text, preds jsonb, submitted_at timestamptz default now());
