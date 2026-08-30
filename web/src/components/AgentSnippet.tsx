'use client';

import { useState } from 'react';

/**
 * The integration, as a file you can run rather than as an illustration.
 *
 * This used to be a hundred and ten lines: a transaction builder, a polling loop, and a table of
 * contract error codes translated by hand. All of that still happens — it moved into
 * `@stellar-allowance/client`, where it is tested rather than pasted.
 *
 * It also used to have the allowance's contract id substituted into it, because that was the one
 * value nobody could get from anywhere else. There is no such value now. The agent knows its own
 * key, and the allowance is found from it, so this file is the same for everybody and takes no
 * arguments at all.
 */

const SNIPPET = `// Save as buy.mjs — the .mjs matters, these are ESM imports.
//
//   npm i @stellar-allowance/client
//   STELLAR_ALLOWANCE_SECRET=S... node buy.mjs <your-paid-url>
//
import { Allowance, AllowanceRefused } from '@stellar-allowance/client';

// One argument, and it is read from the environment. No contract id: the allowance is found
// from the agent's own key, and everything else comes from the URL you ask it to buy.
const client = new Allowance();

const url = process.argv[2];

if (!url) {
  console.error('usage: STELLAR_ALLOWANCE_SECRET=S... node buy.mjs <paid-url>');
  process.exit(1);
}

try {
  // Behaves like fetch. A URL that never asks for payment comes straight back, and nothing
  // is signed.
  const response = await client.fetch(url);
  console.log(response.status, (await response.text()).slice(0, 120));
} catch (error) {
  if (error instanceof AllowanceRefused) {
    // Not a failed request — your own rules working. 'allowlist' means it was asked to pay
    // somebody you never approved, which is what stops a prompt spending your money.
    console.error('refused —', error.rule + ':', error.message);
  } else {
    console.error(error.message);
  }
  process.exit(1);
}
`;

/**
 * Colours comments, strings and keywords, and nothing else.
 *
 * Comments and strings are matched first and in the same pass, so a keyword inside a string —
 * or a quote inside a comment — cannot be picked up by the later rule. Highlighting is display
 * only: the copy button reads the raw source, so a mistake here can never corrupt what someone
 * pastes into a file.
 */
const TOKENS =
  /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|('(?:[^'\\]|\\.)*')|(\b(?:import|from|export|async|await|const|let|function|return|if|else|throw|new|while|try|catch|of|instanceof|true|false)\b)/g;

function highlight(source: string) {
  const out: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;

  TOKENS.lastIndex = 0;
  while ((match = TOKENS.exec(source)) !== null) {
    if (match.index > last) out.push(source.slice(last, match.index));

    const colour = match[1]
      ? 'var(--faint)' // comment
      : match[2]
        ? 'var(--held)' // string
        : 'var(--lavender)'; // keyword

    out.push(
      <span key={`${match.index}`} style={{ color: colour }}>
        {match[0]}
      </span>,
    );
    last = match.index + match[0].length;
  }

  out.push(source.slice(last));
  return out;
}

export function AgentSnippet() {
  const [copied, setCopied] = useState(false);

  return (
    <div className="relative">
      {/* Sits clear of the scrollbar gutter, which a wider label used to overlap. */}
      <button
        type="button"
        aria-label={copied ? 'Copied' : 'Copy the file'}
        className="chip absolute right-6 top-3 z-10 cursor-pointer bg-[color:var(--panel-2)] transition-colors hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
        style={copied ? { borderColor: 'var(--held)', color: 'var(--held)' } : undefined}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(SNIPPET);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            // Clipboard access can be refused; the text is still selectable.
          }
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>

      <pre className="num text-[11px] leading-relaxed overflow-x-auto max-h-[420px] overflow-y-auto bg-[color:var(--panel-2)] border border-[color:var(--line-bright)] p-4">
        <code>{highlight(SNIPPET)}</code>
      </pre>
    </div>
  );
}
