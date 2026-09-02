import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb",
    },
    middlewareClientMaxBodySize: 25 * 1024 * 1024,
  },
  serverExternalPackages: ["@supabase/supabase-js"],
};

export default nextConfig;
