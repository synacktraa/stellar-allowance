// Save as buy.mjs — the .mjs matters, these are ESM imports.
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
