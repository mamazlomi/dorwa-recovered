import type { createClient } from "@/lib/supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

export type MapSettings = { tileUrl: string; attribution: string; searchUrl: string };

/** Tile and search providers chosen in Dorva settings (OpenStreetMap by default). */
export async function loadMapSettings(supabase: SupabaseClient): Promise<MapSettings> {
  const { data } = await supabase.from("settings").select("key, value").eq("scope", "platform")
    .in("key", ["map.tile_url", "map.attribution", "map.search_url"]);
  const get = (k: string, d: string) => {
    const v = (data as { key: string; value: unknown }[] | null)?.find((r) => r.key === k)?.value;
    return typeof v === "string" ? v : d;
  };
  return {
    tileUrl: get("map.tile_url", "https://tile.openstreetmap.org/{z}/{x}/{y}.png"),
    attribution: get("map.attribution", "© OpenStreetMap"),
    searchUrl: get("map.search_url", "").replace(/\/+$/, ""),
  };
}
