import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: { ignoreDuringBuilds: true },
  poweredByHeader: false,
  // Excel stock files are uploaded through a server action
  experimental: { serverActions: { bodySizeLimit: "8mb" } },
  // exceljs is a Node library: keep it out of the server bundle
  serverExternalPackages: ["exceljs", "unpdf", "jszip"],
};

export default nextConfig;
