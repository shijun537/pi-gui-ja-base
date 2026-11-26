import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import "./globals.css";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, SITE_URL, sitePath } from "./site";
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_TITLE, template: "%s | " + SITE_NAME },
  description: SITE_DESCRIPTION,
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    type: "website",
    url: SITE_URL,
    siteName: SITE_NAME,
    locale: "ja_JP",
  },
  icons: { icon: sitePath("icon.svg") },
};
export const viewport: Viewport = { themeColor: "#101b23" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className={GeistSans.variable + " " + GeistMono.variable}>
      <body>{children}</body>
    </html>
  );
}
