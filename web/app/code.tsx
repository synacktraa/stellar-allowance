'use client';

import { useState, type ReactNode } from 'react';

/** What the agent imports, and the one command that puts it there. */
export const INSTALL = 'npm i @stellar-allowance/sdk';

export const AGENT_CODE = `import { Allowance } from '@stellar-allowance/sdk';

const { fetch } = new Allowance();
const response = await fetch('https://api.example.com/paid');`;

const Clip = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3">
    <rect x="5.75" y="5.75" width="8.5" height="9.5" rx="1.5" />
    <path d="M10.75 3.25v-1a1.5 1.5 0 0 0-1.5-1.5h-6a1.5 1.5 0 0 0-1.5 1.5v8a1.5 1.5 0 0 0 1.5 1.5h1" />
  </svg>
);

const Tick = () => (
  <svg
    viewBox="0 0 16 16"
    width="14"
    height="14"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 8.5 6.5 12 13 4.5" />
  </svg>
);

/**
 * The control on a block worth copying.
 *
 * A glyph rather than a word: three blocks on a page carrying "Copy the .env", "Copy command"
 * and "Copy code" narrate a thing the icon already says. The name is still there for anyone
 * reading the page rather than looking at it.
 */
export function Copy({ text, what }: { text: string; what: string }) {
  const [done, setDone] = useState(false);
  const said = done ? 'Copied' : `Copy ${what}`;
  return (
    <button
      className="copy"
      type="button"
      aria-label={said}
      title={said}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Tick /> : <Clip />}
    </button>
  );
}

/**
 * A block and the control that copies it.
 *
 * The control is anchored here rather than inside the block, because the block scrolls sideways
 * and a control that goes with the text is a control that leaves the screen.
 */
export function Block({
  copy,
  what,
  pale,
  children,
}: {
  copy?: string;
  what: string;
  pale?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={pale ? 'block pale' : 'block'}>
      {children}
      {copy && <Copy text={copy} what={what} />}
    </div>
  );
}

/**
 * The four lines an agent runs, colored by hand.
 *
 * They never change, which is the point rather than an oversight: the library reads its pair
 * out of the environment, so an agent moved from one allowance to another is a change of
 * configuration and not of code.
 */
export function AgentLines() {
  return (
    <Block copy={AGENT_CODE} what="the code">
      <pre className="code">
        <span className="c2">import</span> {'{ Allowance }'} <span className="c2">from</span>{' '}
        <span className="c3">&apos;@stellar-allowance/sdk&apos;</span>;{'\n\n'}
        <span className="c2">const</span> {'{ fetch }'} = <span className="c2">new</span> Allowance();
        {'\n'}
        <span className="c2">const</span> response = <span className="c2">await</span> fetch(
        <span className="c3">&apos;https://api.example.com/paid&apos;</span>);
      </pre>
    </Block>
  );
}

/** The install command, on its own line because it is a shell command and the block below is not. */
export function Install() {
  return (
    <Block copy={INSTALL} what="the install command" pale>
      <pre className="install">{INSTALL}</pre>
    </Block>
  );
}
