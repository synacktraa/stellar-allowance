// Prepares one contributor's own testnet fixtures for the live payment test.
//
// Every step checks whether it is already done, so a half-finished run resumes rather than
// starting over, and nothing here is shared between contributors: each gets their own owner
// account, their own agent key and their own allowance.
//
//   npm run e2e:setup
//
// Secrets are written to .env.local and never printed.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  Asset,
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  Horizon,
  contract,
  rpc,
  xdr,
  Address,
} from '@stellar/stellar-sdk';
import { decodePaymentRequiredHeader } from '@x402/core/http';

import { deriveAllowanceAddress, generateAllowanceSalt } from '../../dist/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(HERE, '.env.local');

const NETWORK = Networks.TESTNET;
const RPC_URL = 'https://soroban-testnet.stellar.org';
const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const FRIENDBOT = 'https://friendbot.stellar.org';

const FACILITATOR_URL = 'https://channels.openzeppelin.com/x402/testnet';
const FACILITATOR_KEYGEN = 'https://channels.openzeppelin.com/testnet/gen';

// The one asset constant. Its contract address is computed rather than written down, and the
// seller's 402 is checked against that, so a seller asking for something else fails clearly.
const USDC = new Asset('USDC', 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');

const RELEASE = 'allowance-contract-v0.2.0';
const WASM_URL =
  `https://github.com/synacktraa/stellar-allowance/releases/download/${RELEASE}/allowance.wasm`;

// Small enough that a mistake costs nothing, and the cap sits below the deposit so exceeding
// the window does not also exhaust the balance.
const DEPOSIT = 5_000_000n; // 0.5 USDC
const WINDOW_CAP = 2_000_000n; // 0.2 USDC
const WINDOW_LEDGERS = 17_280; // about a day
const SWAP_XLM = 100_000_000n; // 10 XLM, worth well over the deposit
const INDEX_WINDOW = 45; // how far to probe for a free index

const server = new rpc.Server(RPC_URL);
const horizon = new Horizon.Server(HORIZON_URL);

// --- env file -------------------------------------------------------------------------

function readEnv() {
  if (!existsSync(ENV_PATH)) return {};
  return Object.fromEntries(
    readFileSync(ENV_PATH, 'utf8')
      .split('\n')
      .filter((line) => line.trim() && !line.startsWith('#'))
      .map((line) => {
        const at = line.indexOf('=');
        return [line.slice(0, at), line.slice(at + 1)];
      }),
  );
}

function writeEnv(env) {
  const order = [
    'FACILITATOR_URL',
    'FACILITATOR_API_KEY',
    'E2E_PAID_URL',
    'E2E_OWNER_ADDRESS',
    'E2E_OWNER_SECRET',
    'E2E_SELLER_ADDRESS',
    'E2E_TOKEN',
    'E2E_INDEX',
    'STELLAR_ALLOWANCE_ID',
    'STELLAR_ALLOWANCE_SECRET',
  ];
  const keys = [...order.filter((k) => k in env), ...Object.keys(env).filter((k) => !order.includes(k))];
  writeFileSync(ENV_PATH, keys.map((k) => `${k}=${env[k]}`).join('\n') + '\n');
}

const step = (n, what) => console.log(`\n${n}. ${what}`);
const done = (what) => console.log(`   ${what}`);
const skip = (what) => console.log(`   already done: ${what}`);

// --- classic operations ---------------------------------------------------------------

async function submitClassic(keypair, ...operations) {
  const account = await horizon.loadAccount(keypair.publicKey());
  const tx = operations
    .reduce(
      (builder, op) => builder.addOperation(op),
      new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK }),
    )
    .setTimeout(60)
    .build();
  tx.sign(keypair);
  return horizon.submitTransaction(tx);
}

async function accountOf(address) {
  try {
    return await horizon.loadAccount(address);
  } catch (error) {
    if (error?.response?.status === 404) return null;
    throw error;
  }
}

const balanceOf = (account, asset) =>
  account?.balances.find(
    (b) => b.asset_code === asset.getCode() && b.asset_issuer === asset.getIssuer(),
  );

// --- soroban ---------------------------------------------------------------------------

function instanceKey(contractId) {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
}

/**
 * The first index with nothing at its derived address.
 *
 * Presence is occupancy: an archived allowance still holds its address, so an entry that comes
 * back at all means the index is taken however dead it looks. One request covers the window.
 */
async function firstFreeIndex(owner) {
  const addresses = Array.from({ length: INDEX_WINDOW }, (_, i) =>
    deriveAllowanceAddress({ owner, index: i, networkPassphrase: NETWORK }),
  );
  const { entries } = await server.getLedgerEntries(...addresses.map(instanceKey));
  const taken = new Set(
    entries.map((entry) => Address.fromScAddress(entry.key.contractData().contract()).toString()),
  );
  const free = addresses.findIndex((address) => !taken.has(address));
  if (free === -1) throw new Error(`no free index in the first ${INDEX_WINDOW}`);
  return free;
}

async function alreadyUploaded(wasmHash) {
  const key = xdr.LedgerKey.contractCode(
    new xdr.LedgerKeyContractCode({ hash: Buffer.from(wasmHash, 'hex') }),
  );
  const { entries } = await server.getLedgerEntries(key);
  return entries.length > 0;
}

async function uploadWasm(keypair, wasm) {
  const account = await server.getAccount(keypair.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK })
    .addOperation(Operation.uploadContractWasm({ wasm }))
    .setTimeout(60)
    .build();
  const prepared = await server.prepareTransaction(tx);
  prepared.sign(keypair);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === 'ERROR') throw new Error(`upload failed: ${JSON.stringify(sent.errorResult)}`);
  return pollUntilDone(sent.hash);
}

async function pollUntilDone(hash) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await server.getTransaction(hash);
    if (result.status === 'SUCCESS') return result;
    if (result.status === 'FAILED') throw new Error(`transaction ${hash} failed`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`transaction ${hash} did not settle`);
}

// --- the steps ---------------------------------------------------------------------------

async function main() {
  const env = readEnv();
  env.FACILITATOR_URL = FACILITATOR_URL;
  env.E2E_PAID_URL = process.env.E2E_PAID_URL ?? env.E2E_PAID_URL ?? '';

  step(1, 'Facilitator key');
  if (env.FACILITATOR_API_KEY) {
    skip(`${env.FACILITATOR_API_KEY.length} characters`);
  } else {
    const response = await fetch(FACILITATOR_KEYGEN);
    if (!response.ok) throw new Error(`key generation returned ${response.status}`);
    env.FACILITATOR_API_KEY = (await response.json()).apiKey;
    done(`generated, ${env.FACILITATOR_API_KEY.length} characters`);
  }
  writeEnv(env);

  step(2, 'Owner account');
  if (!env.E2E_OWNER_SECRET) {
    const owner = Keypair.random();
    env.E2E_OWNER_SECRET = owner.secret();
    env.E2E_OWNER_ADDRESS = owner.publicKey();
    done(`generated ${owner.publicKey()}`);
  } else {
    skip(env.E2E_OWNER_ADDRESS);
  }
  writeEnv(env);
  const owner = Keypair.fromSecret(env.E2E_OWNER_SECRET);

  step(3, 'Funding');
  if (await accountOf(owner.publicKey())) {
    skip('the account exists');
  } else {
    const funded = await fetch(`${FRIENDBOT}?addr=${owner.publicKey()}`);
    if (!funded.ok) throw new Error(`friendbot returned ${funded.status}`);
    done('funded by friendbot');
  }

  step(4, 'USDC trustline');
  let account = await accountOf(owner.publicKey());
  if (balanceOf(account, USDC)) {
    skip('the trustline is there');
  } else {
    await submitClassic(owner, Operation.changeTrust({ asset: USDC }));
    account = await accountOf(owner.publicKey());
    done('added');
  }

  step(5, 'USDC balance');
  const held = balanceOf(account, USDC);
  if (Number(held.balance) > 0) {
    skip(`${held.balance} USDC`);
  } else {
    // Circle's faucet is a browser flow. The testnet DEX is not, and a strict-send path
    // payment turns friendbot XLM into USDC in one operation.
    await submitClassic(
      owner,
      Operation.pathPaymentStrictSend({
        sendAsset: Asset.native(),
        sendAmount: (SWAP_XLM / 10_000_000n).toString(),
        destination: owner.publicKey(),
        destAsset: USDC,
        destMin: '1',
        path: [],
      }),
    );
    const after = balanceOf(await accountOf(owner.publicKey()), USDC);
    done(`swapped ${SWAP_XLM / 10_000_000n} XLM for ${after.balance} USDC`);
  }

  step(6, 'What the seller wants');
  if (!env.E2E_PAID_URL) {
    console.log('   no seller URL yet. Set E2E_PAID_URL and run this again to finish.');
    writeEnv(env);
    return;
  }
  const unpaid = await fetch(env.E2E_PAID_URL);
  if (unpaid.status !== 402) throw new Error(`expected 402, got ${unpaid.status}`);
  const header = unpaid.headers.get('payment-required');
  if (!header) throw new Error('402 carried no PAYMENT-REQUIRED header, so it is not x402 v2');
  const [wants] = decodePaymentRequiredHeader(header).accepts;

  const expectedAsset = USDC.contractId(NETWORK);
  if (wants.asset !== expectedAsset) {
    throw new Error(
      `the seller wants ${wants.asset}, and this setup only knows how to acquire ` +
        `${USDC.getCode()} (${expectedAsset})`,
    );
  }
  env.E2E_SELLER_ADDRESS = wants.payTo;
  env.E2E_TOKEN = wants.asset;
  done(`pays ${wants.payTo}, ${wants.amount} of ${wants.asset}`);
  writeEnv(env);

  step(7, 'Agent key');
  if (!env.STELLAR_ALLOWANCE_SECRET) {
    env.STELLAR_ALLOWANCE_SECRET = Keypair.random().secret();
    done('generated');
  } else {
    skip('present');
  }
  writeEnv(env);
  const agent = Keypair.fromSecret(env.STELLAR_ALLOWANCE_SECRET);

  step(8, 'Allowance');
  if (env.STELLAR_ALLOWANCE_ID) {
    skip(env.STELLAR_ALLOWANCE_ID);
    console.log('\nReady. Run: npm run e2e');
    return;
  }

  const index = await firstFreeIndex(owner.publicKey());
  const salt = generateAllowanceSalt(owner.publicKey(), index);
  const expected = deriveAllowanceAddress({
    owner: owner.publicKey(),
    index,
    networkPassphrase: NETWORK,
  });
  done(`index ${index}, expecting ${expected}`);

  const wasm = Buffer.from(await (await fetch(WASM_URL)).arrayBuffer());
  const wasmHash = (await import('node:crypto')).createHash('sha256').update(wasm).digest('hex');
  if (await alreadyUploaded(wasmHash)) {
    done(`wasm ${wasmHash.slice(0, 16)}... is already on the network`);
  } else {
    await uploadWasm(owner, wasm);
    done(`uploaded wasm ${wasmHash.slice(0, 16)}...`);
  }

  const deployment = await contract.Client.deploy(
    {
      setup: {
        owner: owner.publicKey(),
        agent_key: Buffer.from(agent.rawPublicKey()),
        name: 'Research agent',
        spending: { token: wants.asset, initial_deposit: DEPOSIT },
        rules: {
          window_ledgers: WINDOW_LEDGERS,
          window_cap: WINDOW_CAP,
          allowlist: [wants.payTo],
        },
      },
    },
    {
      wasmHash,
      salt,
      networkPassphrase: NETWORK,
      rpcUrl: RPC_URL,
      publicKey: owner.publicKey(),
      signTransaction: new contract.KeypairSigner(owner, NETWORK),
    },
  );
  const { result } = await deployment.signAndSend();
  const deployed = result.options.contractId;

  if (deployed !== expected) {
    throw new Error(`deployed to ${deployed}, but the address was derived as ${expected}`);
  }
  done(`deployed ${deployed}, matching the derived address`);

  env.E2E_INDEX = String(index);
  env.STELLAR_ALLOWANCE_ID = deployed;
  writeEnv(env);

  console.log('\nReady. Run: npm run e2e');
}

await main();
