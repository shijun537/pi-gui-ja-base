import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  output: "export",
  basePath: "/pi-gui-ja-base",
  trailingSlash: true,
  images: { unoptimized: true },
};
export default nextConfig;
