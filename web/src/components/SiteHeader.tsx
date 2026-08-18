'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Two audiences arrive here for opposite reasons: one wants to be paid, the other wants to
 * limit what gets spent. Naming them by what they want, rather than "developers" and "users",
 * means a visitor can pick without reading anything else on the page.
 *
 * The nav is the widest fixed thing on the page, so it is what decides whether a phone scrolls
 * sideways. Below 640px the labels shorten and the right-hand slot drops out; the header must
 * fit the narrowest screen we care about, not the narrowest screen we tested on.
 */
export function SiteHeader({ right }: { right?: React.ReactNode }) {
  const pathname = usePathname();

  const tab = (href: string, long: string, shortLabel: string) => {
    const active = pathname === href;
    return (
      <Link
        href={href}
        aria-current={active ? 'page' : undefined}
        className="chip transition-colors hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
        style={
          active
            ? { borderColor: 'var(--accent)', color: 'var(--accent)' }
            : undefined
        }
      >
        <span className="hidden sm:inline">{long}</span>
        <span className="sm:hidden">{shortLabel}</span>
      </Link>
    );
  };

  return (
    <header className="border-b border-[color:var(--line)] sticky top-0 z-20 bg-[color:var(--ground)]/90 backdrop-blur">
      <div className="mx-auto max-w-[1180px] px-4 sm:px-6 h-14 flex items-center justify-between gap-3 sm:gap-6">
        <Link href="/" className="font-mono text-xs sm:text-sm tracking-tight whitespace-nowrap">
          <span className="hidden sm:inline">STELLAR//ALLOWANCE</span>
          <span className="sm:hidden">S//A</span>
        </Link>

        <nav className="flex items-center gap-1 text-xs">
          {tab('/developer', 'I have an API', 'API')}
          {tab('/user', 'I run an agent', 'Agent')}
        </nav>

        <div className="hidden md:block">
          {right ?? <span className="chip">stellar:testnet</span>}
        </div>
      </div>
    </header>
  );
}
