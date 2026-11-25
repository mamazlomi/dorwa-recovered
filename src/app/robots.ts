import type { MetadataRoute } from "next";
import { loadSeo, SITE_URL } from "@/lib/seo";

export const revalidate = 300;

// Closed to search engines until Dorva switches indexing on (admin › settings › SEO).
export default async function robots(): Promise<MetadataRoute.Robots> {
  const seo = await loadSeo(null);
  if (!seo.indexing) return { rules: [{ userAgent: "*", disallow: "/" }] };
  const priv = ["/api/", "/auth/", "/*/admin", "/*/pharmacy/", "/*/account", "/*/cart", "/*/checkout", "/*/login", "/*/signin-link", "/*/holding"];
  return { rules: [{ userAgent: "*", allow: "/", disallow: priv }], sitemap: `${SITE_URL}/sitemap.xml`, host: SITE_URL };
}
