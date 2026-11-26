import "server-only";
import { createClient as createSupabase } from "@supabase/supabase-js";
import { SUPABASE_URL } from "@/lib/config";

// Service-role client: server code only (never import from a client component).
// Needs SUPABASE_SERVICE_ROLE_KEY in the server environment (Vercel › Environment Variables).
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !key) return null;
  return createSupabase(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
