// Records one live run so the page has proof on screen before it has a wait.
//
//   npm run bake
//
// Drives the same generator the page drives, through the same dependencies, and writes
// lib/demo/baked.json. Run it again to replace the run the page opens with.
//
// No server is involved. The demo stopped being a route when it moved into the browser, and
// this is the other caller of the same code.

import { writeFileSync } from 'node:fs';
import { runDemo } from '../test-dist/lib/demo/run.js';
import { liveDeps } from '../test-dist/lib/demo/live.js';

const final = new Map();
for await (const event of runDemo(liveDeps())) {
  final.set(event.id, event);
  process.stdout.write(`${event.id.padEnd(10)} ${event.state}\n`);
}

const run = { at: new Date().toISOString(), events: [...final.values()] };
const out = new URL('../lib/demo/baked.json', import.meta.url);
writeFileSync(out, JSON.stringify(run, null, 2) + '\n');

const refused = run.events.filter((e) => e.state === 'refused').map((e) => e.rule);
console.log(`baked ${run.events.length} rows at ${run.at}, refused: ${refused.join(', ') || 'none'}`);
