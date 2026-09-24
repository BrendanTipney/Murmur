// Supabase project details. Leave blank to keep Murmur local-only: with no url
// the sync UI stays hidden and nothing ever leaves the device.
//
// Settings -> API in the Supabase dashboard. The anon key is meant to be public
// and is safe to commit, because row-level security is what protects the data
// (see supabase-setup.sql).
export const SUPABASE = {
  url: '',
  anonKey: '',
};
