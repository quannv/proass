import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@proass/shared"],
  // Only our own pages may use the mic and tab capture.
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Permissions-Policy", value: "microphone=(self), display-capture=(self)" }] }];
  },
};

export default nextConfig;
