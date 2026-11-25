import { cookies } from "next/headers";
import type { ThemeConfig } from "@/lib/themeConfig";

/** Grid classes for product lists, from the theme (full class names so Tailwind keeps them). */
export function gridClass(g: ThemeConfig["grid"]): string {
  const mobile = g.mobile === 1 ? "grid-cols-1" : "grid-cols-2";
  const desk = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-2 lg:grid-cols-3", 4: "sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4", 5: "sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" }[g.desktop] ?? "sm:grid-cols-2 lg:grid-cols-3";
  return `grid ${mobile} ${desk} gap-2 sm:gap-3`;
}

/** The visitor's grid/list choice (cookie), else the theme default. */
export async function listView(g: ThemeConfig["grid"]): Promise<"grid" | "list"> {
  if (!g.toggle) return g.view === "list" ? "list" : "grid";
  const c = (await cookies()).get("dorva_view")?.value;
  return c === "list" || c === "grid" ? c : g.view === "list" ? "list" : "grid";
}
