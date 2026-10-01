-- Run once in the Supabase SQL Editor if your project was set up before the
-- per-habit window existed. Without it the app still syncs; it just keeps each
-- habit's window length on the device instead of sharing it between devices.
alter table habits add column if not exists window_days int;
