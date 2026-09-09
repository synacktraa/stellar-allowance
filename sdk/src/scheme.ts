import {
  Address,
  Operation,
  TransactionBuilder,
  contract,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk';
import {
  findDefaultAsset,
  getEstimatedLedgerCloseTimeSeconds,
  getNetworkPassphrase,
  getRpcClient,
  getRpcUrl,
  handleSimulationResult,
  isStellarNetwork,
  validateStellarAssetAddress,
  validateStellarDestinationAddress,
} from '@x402/stellar';
import type { RpcConfig } from '@x402/stellar';
import type {
  PaymentPayloadResult,
  PaymentRequirements,
  SchemeNetworkClient,
} from '@x402/core/types';
import { authorizeAllowanceEntries } from './authorize.js';
import { refusalFrom } from './refusals.js';
import type { AllowanceSigner } from './signer.js';

/**
 * The exact scheme, paying from an allowance.
 *
 * `@x402/stellar`'s `ExactStellarScheme` signs through
 * `AssembledTransaction.signAuthEntries`, which reduces every signature to raw bytes and
 * so cannot authorize a contract address. The build and simulate sequence here is that
 * scheme's, because it is the sequence the facilitator expects on the other end.
 */
export class ExactAllowanceScheme implements SchemeNetworkClient {
  readonly scheme = 'exact';
  findDefaultAsset = findDefaultAsset;

  constructor(
    private readonly signer: AllowanceSigner,
    private readonly rpcConfig?: RpcConfig,
  ) {}

  async createPaymentPayload(
    x402Version: number,
    requirements: PaymentRequirements,
  ): Promise<PaymentPayloadResult> {
    this.check(requirements);
    const { network, payTo, asset, amount, maxTimeoutSeconds } = requirements;
    const networkPassphrase = getNetworkPassphrase(network);
    const rpcUrl = getRpcUrl(network, this.rpcConfig);
    const rpc = getRpcClient(network, this.rpcConfig);

    const args = [
      nativeToScVal(this.signer.address, { type: 'address' }),
      nativeToScVal(payTo, { type: 'address' }),
      nativeToScVal(amount, { type: 'i128' }),
    ];

    const ledgerSeconds = await getEstimatedLedgerCloseTimeSeconds(network);
    const expiration =
      (await rpc.getLatestLedger()).sequence + Math.ceil(maxTimeoutSeconds / ledgerSeconds);

    const [entry] = await authorizeAllowanceEntries(
      [unsignedEntry(this.signer.address, asset, args)],
      this.signer,
      expiration,
      networkPassphrase,
    );

    // Simulation records when the transaction carries no auth entries and enforces when it
    // does, so the entry above is signed first and this one simulation enforces it. Signing
    // after a recording pass leaves its scvVoid signature in place for the host to enforce.
    const tx = await contract.AssembledTransaction.build({
      contractId: asset,
      method: 'transfer',
      args,
      networkPassphrase,
      rpcUrl,
      parseResultXdr: (result: unknown) => result,
      simulate: false,
    });

    // `operations` decodes a fresh copy every time it is read, so assigning to
    // `built.operations[0].auth` leaves the envelope untouched and the entry never reaches
    // the network. The operation is rebuilt instead, which is what assembleTransaction does.
    const built = tx.raw!.build();
    const invoke = built.operations[0] as Operation.InvokeHostFunction;
    tx.built = TransactionBuilder.cloneFrom(built)
      .clearOperations()
      .addOperation(Operation.invokeHostFunction({ func: invoke.func, auth: [entry] }))
      .build();

    // The allowance's rules run here. Simulating a transaction that already carries auth
    // entries enforces them, and assembleTransaction keeps the ones already present.
    await tx.simulate();
    try {
      handleSimulationResult(tx.simulation);
    } catch (error) {
      throw refusalFrom(String(error)) ?? error;
    }

    return { x402Version, payload: { transaction: tx.built!.toXDR() } };
  }

  private check({ scheme, network, payTo, asset, amount, extra }: PaymentRequirements): void {
    if (scheme !== 'exact') {
      throw new Error(`Unsupported scheme: ${scheme}`);
    }
    if (!isStellarNetwork(network)) {
      throw new Error(`Unsupported Stellar network: ${network}`);
    }
    if (typeof amount !== 'string' || !Number.isInteger(Number(amount)) || Number(amount) <= 0) {
      throw new Error(`Invalid amount: ${amount}. Amount must be a positive integer.`);
    }
    if (!validateStellarDestinationAddress(payTo)) {
      throw new Error(`Invalid Stellar destination address: ${payTo}`);
    }
    if (!validateStellarAssetAddress(asset)) {
      throw new Error(`Invalid Stellar asset address: ${asset}`);
    }
    if (!extra?.areFeesSponsored) {
      throw new Error('Exact scheme requires areFeesSponsored to be true');
    }
  }
}

/**
 * An auth entry for `transfer` that nobody has signed yet.
 *
 * The nonce is random and single use: the host rejects a second entry carrying one it has
 * already seen, which is what stops a signature being replayed. `crypto.getRandomValues` and
 * not `node:crypto`, because one `node:` specifier makes this package unbuildable for a browser
 * extension or a page whether or not the line ever runs there.
 */
function unsignedEntry(
  from: string,
  token: string,
  args: xdr.ScVal[],
): xdr.SorobanAuthorizationEntry {
  const nonce = new DataView(crypto.getRandomValues(new Uint8Array(8)).buffer).getBigInt64(0);

  return new xdr.SorobanAuthorizationEntry({
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: new Address(token).toScAddress(),
          functionName: 'transfer',
          args,
        }),
      ),
      subInvocations: [],
    }),
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: new Address(from).toScAddress(),
        nonce: new xdr.Int64(nonce),
        signatureExpirationLedger: 0,
        signature: xdr.ScVal.scvVec([]),
      }),
    ),
  });
}
