// Single entry point for Supabase access.
//
// Feature modules import the client from here (instead of from
// supabase-client.js directly) so there is exactly one way to reach Supabase.
// Config values come from Vite environment variables defined in .env.

export { isSupabaseConfigured, supabase } from "../supabase-client.js";
