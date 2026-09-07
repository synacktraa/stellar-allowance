export const metadata = {
  title: 'Stellar Allowance demo seller',
  description: 'An x402 API priced in USDC on Stellar testnet',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
