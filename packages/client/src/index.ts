import { Contract, Keypair, TransactionBuilder, nativeToScVal, rpc } from '@stellar/stellar-sdk';

/**
 * Pay for API calls without holding the money.
 *
 * The agent gets a secret key and nothing else. That key cannot move a cent: it can only *ask* an
 * allowance contract to pay, and the contract checks the request against rules its owner set —
 * who may be paid, how fast, how much. A stolen key reaches nothing, and neither does a prompt
 * telling the agent to pay somebody it was never allowed to.
 *
 * ```js
 * import { Allowance } from '@stellar-allowance/client';
 *
 * const client = new Allowance();   // reads STELLAR_ALLOWANCE_SECRET
 * const res = await client.fetch('https://…/api/pay/abc123?text=hello');
 * ```
 *
 * `fetch` here is the ordinary one, with the 402 handled in the middle. Same arguments, same
 * `Response` back, and a URL that never asks for payment is passed straight through untouched.
 */

/** Why a payment was refused. `allowlist` is the one worth catching by name. */
export type Rule =
  | 'stopped'
  | 'allowlist'
  | 'rate-limit'
  | 'per-call'
  | 'empty'
  | 'history-full'
  | 'not-set-up'
  | 'invalid-amount';

/**
 * The contract declined, which is not an HTTP failure — it is your own rules working.
 *
 * ```js
 * catch (error) {
 *   if (error instanceof AllowanceRefused && error.rule === 'allowlist') {
 *     // asked to pay somebody the owner never approved
 *   }
 * }
 * ```
 */
export class AllowanceRefused extends Error {
  readonly rule: Rule;

  constructor(rule: Rule, message: string) {
    super(message);
    this.name = 'AllowanceRefused';
    this.rule = rule;
  }
}

const REFUSALS: Record<number, { rule: Rule; message: string }> = {
  2: { rule: 'not-set-up', message: 'this allowance has no agent or no rules yet' },
  3: { rule: 'invalid-amount', message: 'the amount asked for was not a positive number' },
  4: { rule: 'stopped', message: 'the owner has stopped this allowance' },
  5: { rule: 'per-call', message: 'one call worth more than the rate limit allows' },
  6: { rule: 'allowlist', message: 'this allowance is not allowed to pay that recipient' },
  7: { rule: 'rate-limit', message: 'over the rate limit for this window' },
  8: { rule: 'history-full', message: 'too many spends recorded in the current window' },
  10: { rule: 'empty', message: 'the allowance has no credits left' },
};

/**
 * The contract error behind a simulation failure, in words.
 *
 * @internal — exported so it can be tested without a network.
 *
 * The code is parsed rather than substring-matched. `/#1/.test(detail)` is the obvious version
 * and it matches inside `#10`, reporting the wrong rule with complete confidence.
 */
export function refusalFrom(detail: string): { rule: Rule; message: string } | null {
  const match = /Error\(Contract,\s*#(\d+)\)/.exec(detail) ?? /#(\d+)\b/.exec(detail);
  if (!match) return null;
  return REFUSALS[Number(match[1])] ?? null;
}

/**
 * The gateway that issued a paid URL.
 *
 * @internal — exported so it can be tested without a network.
 *
 * Only the origin is derived, never the path. A gateway behind a base path, or a proxy that
 * rewrites, would break anything that assumed the shape `/api/pay/<id>` — and it would break for
 * people running a version of this package that can no longer be changed.
 */
export function originOf(paidUrl: string): string {
  try {
    return new URL(paidUrl).origin;
  } catch {
    throw new TypeError(`Not a valid URL: ${paidUrl}`);
  }
}

type Listed = { contract_id: string; rules: { allowlist: string[] } | null };

/**
 * Which of an agent's allowances may pay this recipient.
 *
 * @internal — exported so it can be tested without a network.
 *
 * Nothing stops one agent key being named by two allowances, so "the agent's allowance" is not
 * always a single thing. The 402 says who it wants paid, and the allowlist says which contract
 * is permitted to pay them — so the recipient decides, not the order the list came back in.
 */
export function chooseAllowance<T extends Listed>(allowances: T[], recipient: string): T | null {
  return allowances.find((a) => (a.rules?.allowlist ?? []).includes(recipient)) ?? null;
}

type Settings = { rpcUrl: string; networkPassphrase: string; maxBodyBytes: number };

export type AllowanceOptions = {
  /** Skip the lookup. For a self-hosted gateway, or when the id is already known. */
  contractId?: string;
  /** Override the RPC the gateway names. */
  rpcUrl?: string;
};

/**
 * How long to wait for a ledger to close before giving up.
 *
 * A submitted transaction is not a guaranteed one — it can be dropped before any ledger takes
 * it, and then it stays NOT_FOUND forever. Hence a deadline rather than a loop.
 */
const LEDGER_DEADLINE_MS = 45_000;

/**
 * The inclusion fee bid, in stroops.
 *
 * Generous, because nobody is watching. This is an unattended agent rather than a wallet popup,
 * so there is no number in front of a human to keep honest, and the cost of being outbid during
 * congestion is a purchase that silently does not happen. Soroban charges only what the
 * transaction uses; the rest of the bid is never taken.
 */
const INCLUSION_FEE = '1000000';

/**
 * The environment variable an agent is expected to hold its key in.
 *
 * Namespaced rather than `AGENT_SECRET`, because an agent process holds a lot of secrets and a
 * generic name is one two libraries can both want. Named for the product the way every other SDK
 * names its variable — it is the secret this needs from you, not a secret belonging to it.
 */
export const SECRET_ENV = 'STELLAR_ALLOWANCE_SECRET';

/** `process.env` where there is one, and nothing where there is not. This package needs no Node. */
function fromEnvironment(name: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  return env?.[name];
}

export class Allowance {
  readonly #agent: Keypair;
  readonly #options: AllowanceOptions;
  #settings = new Map<string, Promise<Settings>>();
  #listed = new Map<string, Promise<Listed[]>>();

  /**
   * @param agentSecret the agent's secret key, `S…`. It holds no money and cannot move any.
   *   Omit it and `STELLAR_ALLOWANCE_SECRET` is read from the environment.
   */
  constructor(agentSecret?: string, options: AllowanceOptions = {}) {
    const secret = agentSecret ?? fromEnvironment(SECRET_ENV);

    if (!secret) {
      throw new TypeError(
        `No agent key. Pass one, or set ${SECRET_ENV} — it is shown once, ` +
          'when the allowance is created.',
      );
    }
    if (typeof secret !== 'string' || !secret.startsWith('S')) {
      throw new TypeError(
        'Expected an agent secret key starting with S. ' +
          'A public key (G…) or a contract id (C…) will not do — this has to sign.',
      );
    }
    this.#agent = Keypair.fromSecret(secret);
    this.#options = options;
  }

  /** The agent's public address. Its owner allowlists what it may pay; it holds nothing. */
  get address(): string {
    return this.#agent.publicKey();
  }

  /**
   * Buy one call.
   *
   * Behaves like `fetch`. A response that is not 402 comes straight back, so this is safe to
   * point at any URL. A 402 is paid for out of the allowance and the request is repeated.
   *
   * @throws {AllowanceRefused} when the contract declines — check `.rule`.
   */
  async fetch(url: string | URL, init: RequestInit = {}): Promise<Response> {
    if (typeof url !== 'string' && !(url instanceof URL)) {
      throw new TypeError(
        'Pass a URL string. A Request object is not supported: its body can only be read once, ' +
          'and a 402 has to be answered by sending the same request again.',
      );
    }
    const target = String(url);
    const origin = originOf(target);
    const settings = await this.#settingsFor(origin);

    if (init.body !== undefined && init.body !== null) {
      this.#checkBody(init.body, settings.maxBodyBytes);
    }

    // 1 — ask. A paid endpoint answers 402 with the price and who to pay.
    const quote = await fetch(target, init);
    if (quote.status !== 402) return quote;

    const { amount, recipient, reference } = (await quote.json()) as {
      amount: string;
      recipient: string;
      reference: string;
    };

    // 2 — ask the allowance to pay it. The rules run during simulation, so a refusal arrives
    // before anything is submitted or paid for.
    const contractId = await this.#contractFor(origin, recipient);
    const hash = await this.#spend(settings, contractId, recipient, amount, reference);

    // 3 — come back and point at the payment.
    const headers = new Headers(init.headers);
    headers.set('x-payment-tx', hash);
    return fetch(target, { ...init, headers });
  }

  /**
   * Refuse an oversized body here, rather than after paying for it.
   *
   * The gateway enforces this too — this package is not in the path when somebody uses curl —
   * but its check happens on the same request, which for a paid call means money already spent.
   */
  #checkBody(body: NonNullable<RequestInit['body']>, limit: number): void {
    if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) {
      throw new TypeError(
        'A streaming body cannot be used. Answering a 402 means sending the same request twice, ' +
          'and a stream reads once. Pass a string, a Buffer or a typed array.',
      );
    }

    // TextEncoder rather than Buffer, so this package does not require Node. The gateway counts
    // UTF-8 bytes and so must this, or a body of CJK would be refused at the wrong threshold —
    // in whichever direction happened to be wrong.
    let bytes: number | null = null;
    if (typeof body === 'string') bytes = new TextEncoder().encode(body).length;
    else if (body instanceof ArrayBuffer) bytes = body.byteLength;
    else if (ArrayBuffer.isView(body)) bytes = body.byteLength;

    if (bytes !== null && bytes > limit) {
      throw new RangeError(
        `Body is ${bytes} bytes; this gateway accepts ${limit}. ` +
          'Refused here so it is not paid for first.',
      );
    }
  }

  /** What the gateway says about itself. One request per origin, for the life of this object. */
  #settingsFor(origin: string): Promise<Settings> {
    const existing = this.#settings.get(origin);
    if (existing) return existing;

    const pending = (async (): Promise<Settings> => {
      const response = await fetch(`${origin}/api/allowances/params`);
      if (!response.ok) {
        throw new Error(`${origin} does not look like a Stellar Allowance gateway.`);
      }
      const body = (await response.json()) as {
        rpc_url: string;
        network_passphrase: string;
        max_body_bytes: number;
      };
      return {
        rpcUrl: this.#options.rpcUrl ?? body.rpc_url,
        networkPassphrase: body.network_passphrase,
        maxBodyBytes: body.max_body_bytes,
      };
    })();

    this.#settings.set(origin, pending);
    return pending;
  }

  /**
   * Which contract to ask.
   *
   * An agent knows its own key and nothing else, so the allowance is looked up from it. The list
   * is remembered, but a recipient that matches nothing is looked up once more before giving
   * up — an owner who has just allowlisted a new API should not have to restart the agent.
   */
  async #contractFor(origin: string, recipient: string): Promise<string> {
    if (this.#options.contractId) return this.#options.contractId;

    let chosen = chooseAllowance(await this.#list(origin), recipient);
    if (!chosen) {
      this.#listed.delete(origin);
      chosen = chooseAllowance(await this.#list(origin), recipient);
    }
    if (!chosen) {
      throw new AllowanceRefused(
        'allowlist',
        `No allowance for ${this.address} may pay ${recipient}. ` +
          'Its owner has to allow that API before this agent can buy from it.',
      );
    }
    return chosen.contract_id;
  }

  #list(origin: string): Promise<Listed[]> {
    const existing = this.#listed.get(origin);
    if (existing) return existing;

    const pending = fetch(`${origin}/api/allowances?agent=${this.address}`)
      .then((r) => r.json())
      .then((body: { allowances?: Listed[] }) => body.allowances ?? []);

    this.#listed.set(origin, pending);
    return pending;
  }

  async #spend(
    settings: Settings,
    contractId: string,
    recipient: string,
    amount: string,
    reference: string,
  ): Promise<string> {
    const server = new rpc.Server(settings.rpcUrl);
    const account = await server.getAccount(this.address);

    const built = new TransactionBuilder(account, {
      fee: INCLUSION_FEE,
      networkPassphrase: settings.networkPassphrase,
    })
      .addOperation(
        new Contract(contractId).call(
          'spend',
          nativeToScVal(recipient, { type: 'address' }),
          nativeToScVal(BigInt(amount), { type: 'i128' }),
          nativeToScVal(reference, { type: 'symbol' }),
        ),
      )
      .setTimeout(60)
      .build();

    let prepared;
    try {
      prepared = await server.prepareTransaction(built);
    } catch (cause) {
      const refusal = refusalFrom(String(cause));
      if (refusal) throw new AllowanceRefused(refusal.rule, refusal.message);
      throw cause;
    }
    prepared.sign(this.#agent);

    const sent = await server.sendTransaction(prepared);
    if (sent.status !== 'PENDING' && sent.status !== 'DUPLICATE') {
      throw new Error(`The network would not take the payment: ${sent.status}`);
    }

    let result = await server.getTransaction(sent.hash);
    const deadline = Date.now() + LEDGER_DEADLINE_MS;
    while (result.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
      if (Date.now() > deadline) {
        throw new Error(`Payment ${sent.hash} was never included in a ledger.`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
      result = await server.getTransaction(sent.hash);
    }
    if (result.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
      throw new Error(`Payment ${sent.hash} reverted on chain.`);
    }

    return sent.hash;
  }
}
