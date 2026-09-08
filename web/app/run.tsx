'use client';

import { useState, type CSSProperties } from 'react';
import type { DemoEvent } from '@/lib/demo/events';

const STEPS: Array<Pick<DemoEvent, 'id' | 'party' | 'title'>> = [
  { id: 'fund', party: 'owner', title: 'Fund an owner' },
  { id: 'trustline', party: 'owner', title: 'Add the USDC trustline' },
  { id: 'swap', party: 'owner', title: 'Swap 10 XLM for USDC' },
  { id: 'deploy', party: 'owner', title: 'Deploy the allowance' },
  { id: 'pay-1', party: 'agent', title: 'Pay the seller' },
  { id: 'stranger', party: 'agent', title: 'Prompt-injected to pay a stranger' },
  { id: 'pay-2', party: 'agent', title: 'Pay the seller again' },
  { id: 'pay-3', party: 'agent', title: 'Pay the seller a third time' },
];

const VERB: Record<string, string> = {
  fund: 'funded',
  trustline: 'added',
  swap: 'swapped',
  deploy: 'deployed',
};

type Live = 'idle' | 'running' | 'busy' | 'done';

const explorer = (event: DemoEvent) =>
  `https://stellar.expert/explorer/testnet/${event.id === 'deploy' ? 'contract' : 'tx'}/${event.hash}`;

export function Run({ baked, at }: { baked: DemoEvent[]; at: string }) {
  const [rows, setRows] = useState(() => new Map(baked.map((e) => [e.id, e])));
  const [live, setLive] = useState<Live>('idle');
  const [startedAt, setStartedAt] = useState(at);

  function start() {
    const source = new EventSource('/api/demo/run');
    setRows(new Map());
    setLive('running');
    setStartedAt(new Date().toISOString());
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as DemoEvent;
      setRows((current) => new Map(current).set(event.id, event));
    };
    source.addEventListener('end', () => {
      source.close();
      setLive('done');
    });
    source.onerror = () => {
      source.close();
      setLive((state) => (state === 'running' ? 'busy' : state));
    };
  }

  return (
    <section>
      <p className="kicker">
        <span>{live === 'running' ? 'Running now' : 'One run'}</span>
        <span className="num">{startedAt.replace('T', ' ').slice(0, 16)} UTC</span>
      </p>

      <div className="run">
        {STEPS.map((step, i) => {
          const event = rows.get(step.id);
          const state = event?.state ?? (live === 'running' ? 'pending' : 'idle');
          return (
            <div key={step.id} className={`row ${state}`} style={{ '--i': i } as CSSProperties}>
              <span className="who">{step.party}</span>
              <div className="what">
                <span>{step.title}</span>
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
              <span className="state">
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

      <p style={{ marginTop: 24 }}>
        <button className="cta" onClick={start} disabled={live === 'running'}>
          {live === 'running' ? 'Running on testnet' : 'Run it live'}
          <small>
            {live === 'busy'
              ? 'another run is in progress, try again in a minute'
              : 'testnet · about a minute · no wallet'}
          </small>
        </button>
      </p>
    </section>
  );
}
