import { getNetwork, isConnected, requestAccess, signTransaction } from '@stellar/freighter-api';
import { Networks } from '@stellar/stellar-sdk';

// Freighter answers with an error field rather than throwing, so every call is checked the
// same way. The wallet has to be on testnet: the contract, the USDC and the seller all are.
export async function connect(): Promise<{ address: string }> {
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
  return { address: access.address };
}

// The same shape stellar-sdk expects from a signer, so it is handed over as is.
export const freighterSigner = signTransaction;
