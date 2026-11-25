"use server";

import { createClient, getUser } from "@/lib/supabase/server";

export type WidgetPos = { id: string; size: "s" | "m" | "l"; hidden?: boolean };

const SCOPE = /^(platform|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

// Saves the signed-in user's widget layout for one dashboard. Rows are the
// user's own (RLS), so nobody can change someone else's layout.
export async function saveLayout(scope: string, widgets: WidgetPos[]): Promise<boolean> {
  if (!SCOPE.test(scope) || !Array.isArray(widgets) || widgets.length > 60) return false;
  const clean = widgets
    .filter((w) => w && typeof w.id === "string" && /^[a-z_]{2,30}$/.test(w.id))
    .map((w) => ({ id: w.id, size: (["s", "m", "l"].includes(w.size) ? w.size : "m") as WidgetPos["size"], hidden: !!w.hidden }));
  const { user } = await getUser();
  if (!user) return false;
  const supabase = await createClient();
  const { error } = await supabase.from("dashboard_layouts")
    .upsert({ user_id: user.id, scope, widgets: clean, updated_at: new Date().toISOString() }, { onConflict: "user_id,scope" });
  return !error;
}

export async function resetLayout(scope: string): Promise<boolean> {
  if (!SCOPE.test(scope)) return false;
  const { user } = await getUser();
  if (!user) return false;
  const supabase = await createClient();
  const { error } = await supabase.from("dashboard_layouts").delete().eq("user_id", user.id).eq("scope", scope);
  return !error;
}
