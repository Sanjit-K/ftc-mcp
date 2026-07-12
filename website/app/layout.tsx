import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sanjit-k.github.io/ftc-toolchain/";
const socialImage = basePath ? `${basePath}/og.png` : "https://sanjit-k.github.io/ftc-toolchain/og.png";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "FTC Toolchain — AI tools for FTC robot code",
  description: "Give your AI the tools to scaffold, build, deploy, and debug FTC robot code.",
  icons: { icon: `${basePath}/favicon.svg`, shortcut: `${basePath}/favicon.svg` },
  openGraph: {
    title: "FTC Toolchain — Your AI can build the robot now.",
    description: "Scaffold, build, and deploy FTC robot code with your MCP-compatible AI.",
    images: [{ url: socialImage, width: 1200, height: 630, alt: "FTC Toolchain developer tool" }],
  },
  twitter: { card: "summary_large_image", images: [socialImage] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
