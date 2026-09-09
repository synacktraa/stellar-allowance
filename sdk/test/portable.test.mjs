import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));

async function sources(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await sources(path)));
    else if (entry.name.endsWith('.js')) found.push(path);
  }
  return found;
}

// An agent is not always a process on a server. It can be a browser extension or a page, and a
// single `node:` specifier anywhere in the package fails that build, whether or not the code
// path is ever taken.
test('nothing in the package imports a node builtin', async () => {
  const offenders = [];
  for (const file of await sources(DIST)) {
    const code = await readFile(file, 'utf8');
    // Every form a specifier can arrive in: `from 'node:x'`, a bare side-effect import,
    // `import('node:x')` and `require('node:x')`. Backticked prose about node: is not one.
    const specifiers = /(?:from|import|require)\s*\(?\s*['"](node:[^'"]+)['"]/g;
    for (const [, specifier] of code.matchAll(specifiers)) {
      offenders.push(`${file.slice(DIST.length)} imports ${specifier}`);
    }
  }
  assert.deepEqual(offenders, []);
});
