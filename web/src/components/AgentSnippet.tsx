'use client';

import { useState } from 'react';

/**
 * The integration, as a file you can run rather than as an illustration.
 *
 * An excerpt with undeclared variables in it costs the reader the exact work the page is meant
 * to save: they have to reconstruct the setup, guess at the error handling, and find out which
 * parts were real only by running it. So this is complete — imports, config, the refusal codes
 * translated — and the contract id is substituted in, because it is the one value that cannot
 * be copied from anywhere else.
 */

function snippet(allowanceId: string) {
  return `// Save as buy.mjs — the .mjs matters, these are ESM imports.
//
//   npm i @stellar/stellar-sdk
//   STELLAR_ALLOWANCE_SECRET=S... node buy.mjs <your-paid-url>
//
// Or paste it into examples/runner in the repo, where that is already set up.
//
import { Contract, Keypair, TransactionBuilder, nativeToScVal, rpc } from '@stellar/stellar-sdk';

const RPC        = 'https://soroban-testnet.stellar.org';
const PASSPHRASE = 'Test SDF Network ; September 2015';
const ALLOWANCE  = '${allowanceId}';
const AGENT      = Keypair.fromSecret(required('STELLAR_ALLOWANCE_SECRET'));

function required(name) {
  const value = process.env[name];
  if (value) return value;
  // Without this, a missing key surfaces as a TypeError from inside the SDK's base32
  // decoder, several frames deep and naming neither the variable nor this file.
  console.error(name + ' is not set.  usage: STELLAR_ALLOWANCE_SECRET=S... node buy.mjs <paid-url>');
  process.exit(1);
}

const server = new rpc.Server(RPC);

/**
 * Buy one call. Resolves with the API's own response, or throws with the rule that refused it.
 * The agent holds no money — every payment here is the contract's, made on request.
 */
export async function buy(url) {
  // 1 — ask. A paid endpoint answers 402 with the price and who to pay.
  const quote = await fetch(url);
  if (quote.status !== 402) return quote;
  const { amount, recipient, reference } = await quote.json();

  // 2 — ask the allowance to pay it.
  const account = await server.getAccount(AGENT.publicKey());
  const tx = new TransactionBuilder(account, { fee: '2000000', networkPassphrase: PASSPHRASE })
    .addOperation(
      new Contract(ALLOWANCE).call(
        'spend',
        nativeToScVal(recipient,      { type: 'address' }),
        nativeToScVal(BigInt(amount), { type: 'i128'    }),
        nativeToScVal(reference,      { type: 'symbol'  }),
      ),
    )
    .setTimeout(60)
    .build();

  let prepared;
  try {
    // Simulation runs the rules, so a refusal arrives before anything is submitted or paid for.
    prepared = await server.prepareTransaction(tx);
  } catch (cause) {
    throw new Error('refused — ' + why(String(cause)));
  }
  prepared.sign(AGENT);

  const sent = await server.sendTransaction(prepared);
  if (sent.status !== 'PENDING' && sent.status !== 'DUPLICATE') {
    throw new Error('not submitted: ' + sent.status);
  }

  // A submitted transaction is not a guaranteed one — it can be dropped before any ledger
  // takes it, and then this stays NOT_FOUND forever. Hence the deadline.
  let result = await server.getTransaction(sent.hash);
  const deadline = Date.now() + 45_000;
  while (result.status === 'NOT_FOUND') {
    if (Date.now() > deadline) throw new Error('never included in a ledger');
    await new Promise((r) => setTimeout(r, 1000));
    result = await server.getTransaction(sent.hash);
  }
  if (result.status !== 'SUCCESS') throw new Error('reverted on chain');

  // 3 — come back and point at the payment.
  return fetch(url, { headers: { 'x-payment-tx': sent.hash } });
}

/** The contract's error codes, in words. */
function why(detail) {
  if (/#4/.test(detail))  return 'agent revoked';
  if (/#5/.test(detail))  return 'one call worth more than the rate limit allows';
  if (/#6/.test(detail))  return 'recipient not on the allowlist';
  if (/#7/.test(detail))  return 'over the window cap';
  if (/#10/.test(detail)) return 'the allowance is empty';
  return detail.split('\\n')[0];
}

// --- run it -----------------------------------------------------------------
// Without this the file only defines buy() and exits without doing anything.

const url = process.argv[2];

if (!url) {
  console.error('usage: STELLAR_ALLOWANCE_SECRET=S... node buy.mjs <paid-url>');
  process.exit(1);
}

try {
  const response = await buy(url);
  console.log(response.status, (await response.text()).slice(0, 120));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
`;
}

/**
 * Colours comments, strings and keywords, and nothing else.
 *
 * Comments and strings are matched first and in the same pass, so a keyword inside a string —
 * or a quote inside a comment — cannot be picked up by the later rule. Highlighting is display
 * only: the copy button reads the raw source, so a mistake here can never corrupt what someone
 * pastes into a file.
 */
const TOKENS =
  /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|('(?:[^'\\]|\\.)*')|(\b(?:import|from|export|async|await|const|let|function|return|if|throw|new|while|try|catch|of|true|false)\b)/g;

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

export function AgentSnippet({ allowanceId }: { allowanceId: string }) {
  const [copied, setCopied] = useState(false);
  const code = snippet(allowanceId);

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
            await navigator.clipboard.writeText(code);
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
        <code>{highlight(code)}</code>
      </pre>
    </div>
  );
}
