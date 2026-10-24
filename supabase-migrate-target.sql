-- Run once in the Supabase SQL Editor if your project was set up before the
-- per-habit "days needed" setting existed. Without it the app still syncs; it
-- just keeps each habit's target on the device instead of sharing it.
alter table habits add column if not exists target_days int;
