'use client';

import { useState, type CSSProperties } from 'react';
import type { DemoEvent } from '@/lib/demo/events';

const VERB: Record<string, string> = {
  fund: 'funded',
  trustline: 'added',
  swap: 'swapped',
  deploy: 'deployed',
};

type Live = 'idle' | 'running' | 'done' | 'stopped';

const explorer = (event: DemoEvent) =>
  `https://stellar.expert/explorer/testnet/${event.id === 'deploy' ? 'contract' : 'tx'}/${event.hash}`;

// The rows a live run has not reached yet are the recorded run's own. A second list that names
// the steps for itself goes stale the moment the run changes, silently, on the first screen.
export function Run({ baked, at }: { baked: DemoEvent[]; at: string }) {
  const [rows, setRows] = useState(() => new Map(baked.map((e) => [e.id, e])));
  const [live, setLive] = useState<Live>('idle');
  const [startedAt, setStartedAt] = useState(at);

  // The run happens here, in this browser, against the public network. There is nothing of ours
  // between the button and the chain: no route, no queue, and no shared address for friendbot to
  // rate limit, because the requests come from whoever pressed it.
  async function start() {
    setRows(new Map());
    setLive('running');
    setStartedAt(new Date().toISOString());
    try {
      // Loaded on the press rather than with the page. Most of this weight is stellar-sdk, and
      // a reader who never runs it should not pay for it.
      const [{ runDemo }, { liveDeps }] = await Promise.all([
        import('@/lib/demo/run'),
        import('@/lib/demo/live'),
      ]);
      for await (const event of runDemo(liveDeps())) {
        setRows((current) => new Map(current).set(event.id, event));
      }
      setLive('done');
    } catch {
      setLive('stopped');
    }
  }

  return (
    <section>
      <p className="kicker">
        <span>{live === 'running' ? 'Running now' : 'One run'}</span>
        <span className="num">{startedAt.replace('T', ' ').slice(0, 16)} UTC</span>
      </p>

      <div className="run">
        {baked.map((step, i) => {
          const event = rows.get(step.id);
          const state = event?.state ?? (live === 'running' ? 'pending' : 'idle');
          return (
            <div key={step.id} className={`row ${state}`} style={{ '--i': i } as CSSProperties}>
              <span className="who">{event?.party ?? step.party}</span>
              <div className="what">
                <span>{event?.title ?? step.title}</span>
                {event?.sub && (
                  <span className="sub">
                    {event.sub}
                    {event.hash && (
                      <>
                        {' · '}
                        <a className="hash num" href={explorer(event)} target="_blank" rel="noreferrer">
                          {event.hash.slice(0, 6)}…{event.hash.slice(-4)}
                        </a>
                      </>
                    )}
                  </span>
                )}
              </div>
              <span className="amt num">{event?.amount ?? ''}</span>
              <span className="state" aria-live="polite">
                {state === 'done' && <span className="ok">{VERB[step.id] ?? 'settled'}</span>}
                {state === 'refused' && <span className="chip refused">refused · {event?.rule}</span>}
                {state === 'failed' && <span className="chip failed">failed</span>}
                {state === 'started' && 'working'}
                {state === 'pending' && 'waiting'}
              </span>
            </div>
          );
        })}
      </div>

      <div className="act">
        <button className="cta" onClick={() => void start()} disabled={live === 'running'}>
          {live === 'running' ? 'Running on testnet' : live === 'idle' ? 'Run it live' : 'Run it again'}
        </button>
        <span className="note-inline">
          {live === 'stopped'
            ? 'the run stopped early. the rows above say where'
            : 'testnet · about a minute · no wallet'}
        </span>
      </div>
    </section>
  );
}
