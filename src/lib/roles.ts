import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type Tab = { id: string; slug: string; title: Record<string, string>; is_default: boolean };

/** What the header shows: staff menus only for people who have a role, plus the product tabs. */
export const myRoles = cache(async (userId: string | null): Promise<{ pharmacy: boolean; platform: boolean; tabs: Tab[] }> => {
  const supabase = await createClient();
  const [tabsRes, memRes, permRes] = await Promise.all([
    supabase.rpc("product_tabs"),
    userId ? supabase.from("memberships").select("pharmacy_id").eq("user_id", userId).not("pharmacy_id", "is", null).limit(1) : Promise.resolve({ data: [] }),
    userId ? supabase.rpc("my_platform_permissions") : Promise.resolve({ data: [] }),
  ]);
  const perms = (permRes.data as string[] | null) ?? [];
  return {
    tabs: ((tabsRes.data as Tab[] | null) ?? []).slice(0, 8),
    pharmacy: ((memRes.data as unknown[] | null) ?? []).length > 0,
    platform: perms.length > 0,
  };
});
