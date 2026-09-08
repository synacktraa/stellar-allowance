import { Buffer } from 'buffer';
import { Keypair, Networks, contract, rpc, xdr } from '@stellar/stellar-sdk';
import { generateAllowanceSalt } from '@stellar-allowance/sdk';
import { freighterSigner } from './wallet';

export const RPC_URL = 'https://soroban-testnet.stellar.org';
export const HORIZON_URL = 'https://horizon-testnet.stellar.org';
export const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
export const USDC_SAC = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';

// The contract code of release allowance-contract-v0.2.0, already installed on testnet. The
// page checks the ledger for it rather than fetching the file: the release asset is not served
// with CORS headers, and the hash is what a deploy needs anyway.
export const WASM_HASH = '6077823e41bb7de03da15497b5996894609a3caa26fab363efdf0a0499eeb7c2';

export interface Rules {
  name: string;
  deposit: bigint;
  cap: bigint;
  windowLedgers: number;
  allowlist: string[];
}

export async function wasmInstalled(server: rpc.Server): Promise<boolean> {
  const key = xdr.LedgerKey.contractCode(
    new xdr.LedgerKeyContractCode({ hash: Buffer.from(WASM_HASH, 'hex') }),
  );
  return (await server.getLedgerEntries(key)).entries.length > 0;
}

// The agent's key is generated here, in the owner's browser, and shown once. The owner's key
// never leaves Freighter: it signs the deploy and nothing else.
export async function deployAllowance(
  owner: string,
  index: number,
  rules: Rules,
): Promise<{ id: string; secret: string }> {
  const agent = Keypair.random();
  const deployment = await contract.Client.deploy(
    {
      setup: {
        owner,
        agent_key: agent.rawPublicKey(),
        name: rules.name,
        spending: { token: USDC_SAC, initial_deposit: rules.deposit },
        rules: { window_ledgers: rules.windowLedgers, window_cap: rules.cap, allowlist: rules.allowlist },
      },
    },
    {
      wasmHash: WASM_HASH,
      salt: generateAllowanceSalt(owner, index),
      networkPassphrase: Networks.TESTNET,
      rpcUrl: RPC_URL,
      publicKey: owner,
      signTransaction: freighterSigner,
    },
  );
  const { result } = await deployment.signAndSend();
  return { id: result.options.contractId, secret: agent.secret() };
}
