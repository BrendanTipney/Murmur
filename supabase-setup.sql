-- Murmur sync tables. Run in the Supabase SQL Editor (SQL Editor -> New Query -> paste -> Run).
-- Safe to run in the same project as other apps: these are their own tables.
--
-- Unlike the time tracker, nothing here is shared between users: every policy is
-- "your own rows only". Timestamps are client epoch milliseconds (updated_ms) so
-- merging is last-write-wins without any timezone parsing.

create table if not exists habits (
  id text primary key,                   -- generated on the device
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  trigger text default '',
  goal text default '',
  created text default '',
  deleted_ms bigint,                     -- tombstone, so deletes travel between devices
  updated_ms bigint not null default 0,
  inserted_at timestamptz default now()
);

create table if not exists habit_days (
  habit_id text not null references habits(id) on delete cascade,
  day text not null,                     -- local calendar day, YYYY-MM-DD
  user_id uuid not null references auth.users(id) on delete cascade,
  done boolean not null default true,    -- false is a tombstone for an un-ticked day
  updated_ms bigint not null default 0,
  primary key (habit_id, day)
);

create index if not exists habits_user_idx on habits (user_id);
create index if not exists habit_days_user_idx on habit_days (user_id);

alter table habits enable row level security;
alter table habit_days enable row level security;

drop policy if exists "own habits" on habits;
create policy "own habits" on habits
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own habit days" on habit_days;
create policy "own habit days" on habit_days
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
