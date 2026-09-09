// Records one live run so the page has proof on screen before it has a wait.
//
//   npm run dev
//   npm run bake
//
// Reads the stream from a running dev server, keeps the final state of every step, and writes
// lib/demo/baked.json. Run it again to replace the run the page opens with.

import { writeFileSync } from 'node:fs';

const url = process.env.BAKE_URL ?? 'http://localhost:3000/api/demo/run';
const response = await fetch(url);
if (!response.ok) throw new Error(`${url} answered ${response.status}`);

const events = (await response.text())
  .split('\n\n')
  .filter((block) => block.startsWith('data: '))
  .map((block) => JSON.parse(block.slice('data: '.length)))
  .filter((event) => event.id);

const final = new Map();
for (const event of events) final.set(event.id, event);

const run = { at: new Date().toISOString(), events: [...final.values()] };
const out = new URL('../lib/demo/baked.json', import.meta.url);
writeFileSync(out, JSON.stringify(run, null, 2) + '\n');

const refused = run.events.filter((e) => e.state === 'refused').map((e) => e.rule);
console.log(`baked ${run.events.length} rows at ${run.at}, refused: ${refused.join(', ') || 'none'}`);
