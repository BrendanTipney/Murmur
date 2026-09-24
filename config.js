// Supabase project details. Leave blank to keep Murmur local-only: with no url
// the sync UI stays hidden and nothing ever leaves the device.
//
// Settings -> API in the Supabase dashboard. The anon key is meant to be public
// and is safe to commit, because row-level security is what protects the data
// (see supabase-setup.sql).
export const SUPABASE = {
  url: 'https://anpppsamiaukfdodcynm.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFucHBwc2FtaWF1a2Zkb2RjeW5tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyNDg2MjEsImV4cCI6MjEwNTgyNDYyMX0.RxK8Gqaz6rf5DXyhF0W0pOdFwYbeSKAkJH64nrSiCBI',
};
