import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * A submission is shared as a link, so the link has to carry the argument. Vercel exposes the
 * production domain at build time; falling back to localhost keeps `metadataBase` valid in
 * development, where absolute URLs are still required for Open Graph tags.
 */
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");

const description =
  "A spending limit for AI agents, enforced on-chain rather than promised in code.";

/** The social title from the content spec. The tab keeps the short name. */
const socialTitle = "Stellar Allowance — Spending limits for AI agents";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Stellar Allowance",
    template: "%s · Stellar Allowance",
  },
  description,
  applicationName: "Stellar Allowance",
  openGraph: {
    title: socialTitle,
    description,
    url: siteUrl,
    siteName: "Stellar Allowance",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: socialTitle,
    description,
  },
  robots: { index: true, follow: true },
};

export const viewport = {
  themeColor: "#060607",
  colorScheme: "dark" as const,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
