import type { NextConfig } from "next";

// STATIC_EXPORT=1 builds plain files into out/ for static hosts (Amplify manual deploy, see scripts/deploy-web-aws.sh).
// Static hosts can't run headers(), so the host sets Permissions-Policy itself there.
const staticExport = process.env.STATIC_EXPORT === "1";

const nextConfig: NextConfig = {
  transpilePackages: ["@proass/shared"],
  ...(staticExport
    ? { output: "export" }
    : {
        // Only our own pages may use the mic and tab capture.
        async headers() {
          return [{ source: "/(.*)", headers: [{ key: "Permissions-Policy", value: "microphone=(self), display-capture=(self)" }] }];
        },
      }),
};

export default nextConfig;
