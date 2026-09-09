import { getNetwork, isConnected, requestAccess, signTransaction } from '@stellar/freighter-api';
import { Horizon, Networks } from '@stellar/stellar-sdk';
import { USDC_ISSUER } from '../demo/params';

export const HORIZON_URL = 'https://horizon-testnet.stellar.org';

export interface Wallet {
  address: string;
  xlm: string;
  /** Undefined when the account holds no USDC trustline, which is not the same as zero. */
  usdc?: string;
}

// Freighter answers with an error field rather than throwing, so every call is checked the same
// way. The wallet has to be on testnet: the contract, the USDC and the sellers all are.
export async function connect(): Promise<string> {
  const presence = await isConnected();
  if (presence.error || !presence.isConnected) {
    throw new Error('Freighter is not installed. Get it at freighter.app, then reload.');
  }
  const access = await requestAccess();
  if (access.error) throw new Error(access.error.message);
  const net = await getNetwork();
  if (net.error) throw new Error(net.error.message);
  if (net.networkPassphrase !== Networks.TESTNET) {
    throw new Error(`Freighter is on ${net.network}. Switch it to testnet.`);
  }
  return access.address;
}

/**
 * What the owner has to spend.
 *
 * A missing trustline is reported as absent rather than zero. USDC cannot reach an account that
 * has not opted into it, so an owner in that state can deploy an allowance and never fund one,
 * and the interface says so before they try.
 */
export async function readWallet(address: string): Promise<Wallet> {
  const account = await new Horizon.Server(HORIZON_URL).loadAccount(address);
  const xlm = account.balances.find((balance) => balance.asset_type === 'native')?.balance ?? '0';
  const usdc = account.balances.find(
    (balance) =>
      'asset_code' in balance && balance.asset_code === 'USDC' && balance.asset_issuer === USDC_ISSUER,
  );
  return { address, xlm, usdc: usdc?.balance };
}

/** The same shape stellar-sdk wants from a signer, so it is handed over as it is. */
export const freighterSigner = signTransaction;
