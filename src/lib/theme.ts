import { cookies } from "next/headers";
import { cache } from "react";
import { isConfigured } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";
import { DEFAULTS, resolveTheme, type ThemeConfig } from "@/lib/themeConfig";

export { themeCss, themeAttrs } from "@/lib/themeConfig";

// The look visitors get: the scheduled or default theme from the theme studio.
// An editor with the preview cookie sees the draft of the theme being edited.

export const PREVIEW_COOKIE = "dorva_theme_preview";
export type Theme = ThemeConfig & { lowStock: number; preview: { id: string; name: string } | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const loadTheme = cache(async (): Promise<Theme> => {
  if (!isConfigured) return { ...structuredClone(DEFAULTS), lowStock: 3, preview: null };
  try {
    const supabase = await createClient();
    const previewId = (await cookies()).get(PREVIEW_COOKIE)?.value;
    const [{ data: live }, { data: low }, prev] = await Promise.all([
      supabase.rpc("theme_active"),
      supabase.from("settings").select("value").eq("scope", "platform").eq("key", "catalog.low_stock_threshold").maybeSingle(),
      previewId && UUID.test(previewId) ? supabase.rpc("theme_preview", { p_theme: previewId }) : Promise.resolve({ data: null }),
    ]);
    const p = prev.data as { name: string; config: unknown } | null;
    const lowStock = Math.min(50, Math.max(0, Number((low as { value: unknown } | null)?.value ?? 3) || 0));
    return { ...resolveTheme(p ? p.config : live), lowStock, preview: p && previewId ? { id: previewId, name: p.name } : null };
  } catch {
    return { ...structuredClone(DEFAULTS), lowStock: 3, preview: null };
  }
});
