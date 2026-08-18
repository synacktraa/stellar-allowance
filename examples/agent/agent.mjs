/**
 * Replace this whole file.
 *
 * Go to the Stellar Allowance user tab, step 06, and press copy on the code block. It arrives
 * with your allowance's contract id already in it — that is the one value that cannot be copied
 * from anywhere else, which is why this file ships empty rather than nearly finished.
 *
 * Then:
 *
 *   1. put your agent's secret in .env    (AGENT_SECRET=S...)
 *   2. npm start -- <your-paid-url>
 *
 * `type: module` is set in package.json, so the ESM imports work from this filename directly.
 * Dependencies are already installed.
 */

console.log(`
This file is still the placeholder.

  1. Copy the agent file from the user tab, step 06 — it already contains
     your allowance's contract id.
  2. Paste it over this file.
  3. Put your agent's secret in .env
  4. npm start -- <your-paid-url>
`);

process.exit(1);
