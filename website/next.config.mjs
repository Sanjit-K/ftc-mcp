const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const isGitHubPages = Boolean(basePath);

/** @type {import('next').NextConfig} */
const nextConfig = isGitHubPages
  ? {
      output: "export",
      basePath,
      assetPrefix: basePath,
      trailingSlash: true,
      images: { unoptimized: true },
      turbopack: { root: import.meta.dirname },
    }
  : {};

export default nextConfig;
