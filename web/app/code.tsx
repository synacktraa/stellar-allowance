'use client';

import { useState } from 'react';

/** What the agent imports, and the one command that puts it there. */
export const INSTALL = 'npm i @stellar-allowance/sdk';

export const AGENT_CODE = `import { Allowance } from '@stellar-allowance/sdk';

const { fetch } = new Allowance();
const response = await fetch('https://api.example.com/paid');`;

export function Copy({ text, what }: { text: string; what: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="cta quiet sm"
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? 'Copied' : `Copy ${what}`}
    </button>
  );
}

/**
 * The four lines an agent runs, coloured by hand.
 *
 * They never change, which is the point rather than an oversight: the library reads its pair
 * out of the environment, so an agent moved from one allowance to another is a change of
 * configuration and not of code.
 */
export function AgentLines() {
  return (
    <pre className="code">
      <span className="c2">import</span> {'{ Allowance }'} <span className="c2">from</span>{' '}
      <span className="c3">&apos;@stellar-allowance/sdk&apos;</span>;{'\n\n'}
      <span className="c2">const</span> {'{ fetch }'} = <span className="c2">new</span> Allowance();
      {'\n'}
      <span className="c2">const</span> response = <span className="c2">await</span> fetch(
      <span className="c3">&apos;https://api.example.com/paid&apos;</span>);
    </pre>
  );
}

/** The install command, on its own line because it is a shell command and the block below is not. */
export function Install() {
  return (
    <div className="install">
      <code>{INSTALL}</code>
      <Copy text={INSTALL} what="command" />
    </div>
  );
}
