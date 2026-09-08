// Proves each rule refuses on chain rather than in the client, and captures the host error
// that `refusalFrom` has to read.
//
//   node --env-file=test/e2e/.env.local test/e2e/refusals.mjs
//
// The seller never changes. The owner changes the allowance's rules, which is the side the
// rules actually live on.

import { Keypair, Networks, contract } from '@stellar/stellar-sdk';
import { Allowance, AllowanceRefused } from '../../dist/index.js';

const RPC_URL = 'https://soroban-testnet.stellar.org';
const owner = Keypair.fromSecret(process.env.E2E_OWNER_SECRET);
const allowanceId = process.env.STELLAR_ALLOWANCE_ID;
const url = process.env.E2E_PAID_URL;

const client = await contract.Client.from({
  contractId: allowanceId,
  networkPassphrase: Networks.TESTNET,
  rpcUrl: RPC_URL,
  publicKey: owner.publicKey(),
  signTransaction: new contract.KeypairSigner(owner, Networks.TESTNET),
});

const send = async (name, args) => (await client[name](args ?? {})).signAndSend();
// get_config returns Result<Config, AllowanceError>, so the client wraps it in an Ok.
const config = async () => (await client.get_config()).result.unwrap();

async function attempt() {
  const { fetch } = new Allowance();
  try {
    const response = await fetch(url);
    return { paid: response.status };
  } catch (error) {
    if (error instanceof AllowanceRefused) return { refusal: error };
    return { other: error };
  }
}

async function probe(label, expected, apply, restore) {
  process.stdout.write(`\n${label}\n`);
  await apply();
  const result = await attempt();
  await restore();

  if (result.paid) return console.log(`  PAID ${result.paid}, expected a refusal`);
  if (result.other) return console.log(`  not an AllowanceRefused: ${result.other.message.slice(0, 120)}`);

  const { refusal } = result;
  const ok = refusal.rule === expected ? 'ok' : `WRONG, expected ${expected}`;
  console.log(`  rule   ${refusal.rule}  (code ${refusal.code})  ${ok}`);
  console.log(`  host   ${refusal.detail.split('\n')[0].slice(0, 150)}`);
}

const before = await config();
const rules = before.rules;
console.log('allowance', allowanceId);
console.log('allowlist', rules.allowlist.join(', '));
console.log('window   ', rules.window_cap.toString(), 'over', rules.window_ledgers, 'ledgers');

await probe(
  '1. a recipient the owner never approved',
  'allowlist',
  () => send('write', { name: undefined, rules: { ...rules, allowlist: [owner.publicKey()] }, deposit: 0n }),
  () => send('write', { name: undefined, rules, deposit: 0n }),
);

await probe(
  '2. more than the rolling window allows',
  'window',
  () => send('write', { name: undefined, rules: { ...rules, window_cap: 1n }, deposit: 0n }),
  () => send('write', { name: undefined, rules, deposit: 0n }),
);

await probe(
  '3. the owner has stopped the allowance',
  'stopped',
  () => send('disable'),
  () => send('enable'),
);

const after = await config();
const plain = (v) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));
console.log('\nrules restored:', plain(after.rules) === plain(rules), '| enabled:', after.enabled);
