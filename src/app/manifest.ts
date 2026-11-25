import type { MetadataRoute } from "next";

// Installable web app: "Add to Home Screen" opens Dorva full-screen like an app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/fa",
    name: "دوروا — داروخانه نزدیک شما",
    short_name: "دوروا",
    description: "خرید از نزدیک‌ترین داروخانه با بررسی داروساز؛ دارویاب داروهای کمیاب.",
    lang: "fa",
    dir: "rtl",
    start_url: "/fa?source=app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f5f8fb",
    theme_color: "#0e76a8",
    categories: ["medical", "shopping", "health"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "دارویاب", url: "/fa/finder?source=app", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "سبد خرید", url: "/fa/cart?source=app", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "سفارش‌های من", url: "/fa/account/orders?source=app", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
