import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  contract,
  rpc,
  xdr,
} from '@stellar/stellar-sdk';
import { decodePaymentRequiredHeader, decodePaymentResponseHeader } from '@x402/core/http';
import type { PaymentRequirements } from '@x402/core/types';
import { Allowance, AllowanceRefused, generateAllowanceSalt } from '@stellar-allowance/sdk';
import { firstFreeIndex } from '../allowance/index';
import { DEPOSIT, SELLER_URL, WASM_HASH, WINDOW_CAP, WINDOW_LEDGERS } from './params';
import type { Deps, Wants } from './run';

const NETWORK = Networks.TESTNET;
const RPC_URL = 'https://soroban-testnet.stellar.org';
const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const FRIENDBOT = 'https://friendbot.stellar.org';
const USDC = new Asset('USDC', 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');
const server = new rpc.Server(RPC_URL);
const horizon = new Horizon.Server(HORIZON_URL);

async function submitClassic(keypair: Keypair, ...operations: xdr.Operation[]) {
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

export function liveDeps(): Deps {
  return {
    async fund(address) {
      const response = await fetch(`${FRIENDBOT}?addr=${address}`);
      if (!response.ok) throw new Error(`friendbot returned ${response.status}`);
    },

    async trustline(owner) {
      await submitClassic(owner, Operation.changeTrust({ asset: USDC }));
    },

    async swap(owner) {
      await submitClassic(
        owner,
        Operation.pathPaymentStrictSend({
          sendAsset: Asset.native(),
          sendAmount: '100',
          destination: owner.publicKey(),
          destAsset: USDC,
          // A floor rather than a formality: the deposit is 5 USDC, so a thin book has to fail
          // here, where the row says the swap did not fill, and not two steps later on a deploy
          // that looks like the contract's fault.
          destMin: '10',
          path: [],
        }),
      );
      const account = await horizon.loadAccount(owner.publicKey());
      const held = account.balances.find((b) => 'asset_code' in b && b.asset_code === 'USDC');
      return held?.balance ?? '0';
    },

    async seller() {
      const response = await fetch(SELLER_URL);
      const header = response.headers.get('payment-required');
      if (response.status !== 402 || !header) {
        throw new Error(`the seller answered ${response.status}, not a 402`);
      }
      const [wants] = decodePaymentRequiredHeader(header).accepts;
      return { url: SELLER_URL, wants: wants as Wants };
    },

    async deploy(owner, agent, wants) {
      const { index } = await firstFreeIndex(server, owner.publicKey());
      const deployment = await contract.Client.deploy(
        {
          setup: {
            owner: owner.publicKey(),
            agent_key: agent.rawPublicKey(),
            name: 'Demo agent',
            spending: { token: wants.asset, initial_deposit: DEPOSIT },
            rules: { window_ledgers: WINDOW_LEDGERS, window_cap: WINDOW_CAP, allowlist: [wants.payTo] },
          },
        },
        {
          wasmHash: WASM_HASH,
          salt: generateAllowanceSalt(owner.publicKey(), index),
          networkPassphrase: NETWORK,
          rpcUrl: RPC_URL,
          publicKey: owner.publicKey(),
          signTransaction: new contract.KeypairSigner(owner, NETWORK),
        },
      );
      const { result } = await deployment.signAndSend();
      return { id: result.options.contractId, index };
    },

    async pay({ id, secret }, url) {
      const response = await new Allowance({ id, secret }).fetch(url);
      const settled = response.headers.get('payment-response');
      if (!settled) throw new Error(`the seller answered ${response.status} with no payment-response header`);
      const receipt = decodePaymentResponseHeader(settled);
      return { hash: receipt.transaction, payer: receipt.payer ?? id };
    },

    async refuse({ id, secret }, wants) {
      const allowance = new Allowance({ id, secret });
      const stranger = { ...wants, payTo: Keypair.random().publicKey() } as PaymentRequirements;
      try {
        await allowance.scheme.createPaymentPayload(2, stranger);
      } catch (error) {
        if (error instanceof AllowanceRefused) return error;
        throw error;
      }
      throw new Error('the contract let a stranger through');
    },
  };
}
