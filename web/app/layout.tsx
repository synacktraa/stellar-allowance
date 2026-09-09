import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { IBM_Plex_Mono, Inter, Lora } from 'next/font/google';
import './globals.css';

const lora = Lora({ subsets: ['latin'], weight: ['400', '600'], variable: '--font-serif' });
const inter = Inter({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-sans' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: 'Stellar Allowance',
  // Not the headline. The card renders that in type a reader cannot miss, and a description
  // that repeats it spends the only line under the image saying nothing new.
  description: 'On-chain spending limits for AI agents that pay for API calls.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${lora.variable} ${inter.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
