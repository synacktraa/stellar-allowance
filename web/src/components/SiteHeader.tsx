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

        <div className="flex items-center gap-2">
          <div className="hidden md:block">
            {right ?? <span className="chip">stellar:testnet</span>}
          </div>

          {/*
            The claim this project makes — that the rules are enforced somewhere the agent
            cannot reach — is only checkable by reading the contracts. A link to them belongs
            on every page, not buried in a footer on one of them.
          */}
          <a
            href="https://github.com/synacktraa/stellar-allowance"
            target="_blank"
            rel="noreferrer noopener"
            aria-label="Source on GitHub"
            title="Source on GitHub"
            className="chip flex items-center justify-center px-2 py-[5px] transition-colors hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
          >
            <svg
              viewBox="0 0 16 16"
              width="14"
              height="14"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
            </svg>
          </a>
        </div>
      </div>
    </header>
  );
}
