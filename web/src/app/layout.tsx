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
  "Set three limits — most per purchase, most per rolling window, and who may be paid. Your AI agent has to ask before every purchase, and the contract answers. Break a rule and the money does not move.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Stellar Allowance",
    template: "%s · Stellar Allowance",
  },
  description,
  applicationName: "Stellar Allowance",
  openGraph: {
    title: "Stellar Allowance",
    description,
    url: siteUrl,
    siteName: "Stellar Allowance",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stellar Allowance",
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
