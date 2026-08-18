import Link from 'next/link';

/**
 * Two audiences arrive here for opposite reasons: one wants to be paid, the other wants to
 * limit what gets spent. Naming them by what they want, rather than "developers" and "users",
 * means a visitor can pick without reading anything else on the page.
 */
export function SiteHeader({ right }: { right?: React.ReactNode }) {
  return (
    <header className="border-b border-[color:var(--line)] sticky top-0 z-20 bg-[color:var(--ground)]/90 backdrop-blur">
      <div className="mx-auto max-w-[1180px] px-6 h-14 flex items-center justify-between gap-6">
        <Link href="/" className="font-mono text-sm tracking-tight whitespace-nowrap">
          STELLAR//ALLOWANCE
        </Link>

        <nav className="flex items-center gap-1 text-xs">
          <Link
            href="/developer"
            className="chip hover:border-[color:var(--accent)] hover:text-[color:var(--accent)] transition-colors"
          >
            I have an API
          </Link>
          <Link
            href="/user"
            className="chip hover:border-[color:var(--accent)] hover:text-[color:var(--accent)] transition-colors"
          >
            I run an agent
          </Link>
        </nav>

        <div className="hidden sm:block">{right ?? <span className="chip">stellar:testnet</span>}</div>
      </div>
    </header>
  );
}
