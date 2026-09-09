import {
  getAddress,
  getNetwork,
  isAllowed,
  isConnected,
  requestAccess,
  signTransaction,
} from '@stellar/freighter-api';
import { Horizon, Networks } from '@stellar/stellar-sdk';
import { USDC_ISSUER } from '../demo/params';

export const HORIZON_URL = 'https://horizon-testnet.stellar.org';

export interface Wallet {
  address: string;
  xlm: string;
  /** Undefined when the account holds no USDC trustline, which is not the same as zero. */
  usdc?: string;
}

/** The cap a new allowance is offered, in USDC, and how many of those windows the deposit covers. */
const OFFERED_CAP = 5;
const WINDOWS_COVERED = 4;

/** Seven decimals and never an exponent: these strings go into the field the amount parser reads. */
const money = (amount: number): string => amount.toFixed(7).replace(/\.?0+$/, '');

/**
 * What the new-allowance form starts at, given what the wallet holds.
 *
 * A cap above the balance is a rule that can never bind, so a wallet holding less than the
 * offered cap is offered its own balance instead. A wallet holding nothing is offered the plain
 * numbers rather than zeros, because a form full of zeros reads as broken and the deploy is what
 * says, in words, that there is no USDC to deposit.
 */
export function suggestDefaults(usdc?: string): { deposit: string; cap: string } {
  const held = Number(usdc ?? 0);
  const cap = held > 0 ? Math.min(OFFERED_CAP, held) : OFFERED_CAP;
  const deposit = held > 0 ? Math.min(cap * WINDOWS_COVERED, held) : cap * WINDOWS_COVERED;
  return { deposit: money(deposit), cap: money(cap) };
}

/** The calls this page makes on the extension, named so a test can stand in for it. */
export interface Freighter {
  isConnected: typeof isConnected;
  isAllowed: typeof isAllowed;
  getAddress: typeof getAddress;
  getNetwork: typeof getNetwork;
  requestAccess: typeof requestAccess;
}

const extension: Freighter = { isConnected, isAllowed, getAddress, getNetwork, requestAccess };

// The wallet has to be on testnet: the contract, the USDC and the sellers all are.
async function requireTestnet(api: Freighter): Promise<void> {
  const net = await api.getNetwork();
  if (net.error) throw new Error(net.error.message);
  if (net.networkPassphrase !== Networks.TESTNET) {
    throw new Error(`Freighter is on ${net.network}. Switch it to testnet.`);
  }
}

// Freighter answers with an error field rather than throwing, so every call is checked the same
// way.
export async function connect(api: Freighter = extension): Promise<string> {
  const presence = await api.isConnected();
  if (presence.error || !presence.isConnected) {
    throw new Error('Freighter is not installed. Get it at freighter.app, then reload.');
  }
  const access = await api.requestAccess();
  if (access.error) throw new Error(access.error.message);
  await requireTestnet(api);
  return access.address;
}

/**
 * The address this browser has already been given, or null when it has none.
 *
 * Freighter remembers an approval and does not prompt a second time, so a page that asks on every
 * load gets no prompt and no address, and sits there asking for a wallet it could already read.
 */
export async function resume(api: Freighter = extension): Promise<string | null> {
  const presence = await api.isConnected();
  if (presence.error || !presence.isConnected) return null;
  const allowed = await api.isAllowed();
  if (allowed.error || !allowed.isAllowed) return null;
  const address = await api.getAddress();
  if (address.error || !address.address) return null;
  await requireTestnet(api);
  return address.address;
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

/**
 * Freighter's signer, with its error field raised rather than returned.
 *
 * Declining a prompt answers with an empty envelope and an error beside it, and an empty envelope
 * reaches the SDK as an XDR parse failure - which is what the owner would otherwise be shown for
 * having pressed Reject. The wallet's own wording says what happened, so that is what is raised.
 */
export const signWith =
  (sign: typeof signTransaction) =>
  async (xdr: string, opts?: Parameters<typeof signTransaction>[1]) => {
    const signed = await sign(xdr, opts);
    if (signed.error) throw new Error(signed.error.message);
    return signed;
  };

export const freighterSigner = signWith(signTransaction);
