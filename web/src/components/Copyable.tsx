'use client';

import { useState } from 'react';

/**
 * A value worth copying, with the copy affordance attached.
 *
 * Contract ids and agent keys are 56 characters of base32. Selecting one by dragging across a
 * wrapped line is the kind of small failure that makes a demo look unfinished, and it happens
 * in front of whoever is watching.
 */
export function Copyable({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex items-start gap-2">
      <p className="num text-sm break-all min-w-0 flex-1">{value}</p>
      <button
        type="button"
        aria-label={label ? `Copy ${label}` : 'Copy'}
        className="chip shrink-0 cursor-pointer transition-colors hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
        style={copied ? { borderColor: 'var(--held)', color: 'var(--held)' } : undefined}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            // Clipboard access can be refused outright — say nothing rather than throw an
            // error dialog over a value the user can still select by hand.
          }
        }}
      >
        {copied ? 'copied' : 'copy'}
      </button>
    </div>
  );
}
