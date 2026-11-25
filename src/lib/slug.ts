// Pharmacy page address: 3–60 lowercase latin letters, digits and hyphens.
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/;

/**
 * Turns what people type into an address: drops a pasted link's site part
 * (https://www.dorva.ir/fa/...), lowercases, and turns spaces and other
 * separators into hyphens. While typing (`typing`), a trailing hyphen is kept.
 */
export function normalizeSlug(raw: string, typing = false): string {
  let s = raw.trim().toLowerCase();
  s = s.replace(/^[a-z]+:\/\//, "");
  if (s.includes("/")) s = s.split("/").filter(Boolean).pop() ?? "";
  s = s.replace(/[\s_.]+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-+/, "");
  if (!typing) s = s.replace(/-+$/, "");
  return s.slice(0, 60);
}
