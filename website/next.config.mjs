const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const isGitHubPages = Boolean(basePath);
const isLocalStudio = process.env.FTC_LOCAL_STUDIO === "1";

/** @type {import('next').NextConfig} */
const nextConfig = isGitHubPages || isLocalStudio
  ? {
      output: "export",
      ...(basePath ? { basePath, assetPrefix: basePath } : {}),
      trailingSlash: true,
      images: { unoptimized: true },
      turbopack: { root: import.meta.dirname },
    }
  : {};

export default nextConfig;
