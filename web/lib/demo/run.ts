import { Keypair } from '@stellar/stellar-sdk';
import { AllowanceRefused } from '@stellar-allowance/sdk';
import type { DemoEvent } from './events';
import { DEPOSIT, PAYMENTS, WINDOW_CAP, usdc } from './params';

export interface Wants {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

export interface Pair {
  id: string;
  secret: string;
}

export interface Deps {
  fund(address: string): Promise<void>;
  trustline(owner: Keypair): Promise<void>;
  swap(owner: Keypair): Promise<string>;
  seller(): Promise<{ url: string; wants: Wants }>;
  deploy(owner: Keypair, agent: Keypair, wants: Wants): Promise<{ id: string; index: number }>;
  pay(allowance: Pair, url: string): Promise<{ hash: string; payer: string }>;
  refuse(allowance: Pair, wants: Wants): Promise<AllowanceRefused>;
}

type Base = Omit<DemoEvent, 'state'>;

const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;

export async function* runDemo(deps: Deps): AsyncGenerator<DemoEvent> {
  const owner = Keypair.random();
  const agent = Keypair.random();

  // One row: announce it, do the work, report what came back. A refusal is a result and the
  // run goes on. Anything else ends the run at that row.
  async function* step<T>(
    base: Base,
    work: () => Promise<T>,
    after: (result: T) => Partial<DemoEvent>,
    refused?: (rule: string) => string,
  ): AsyncGenerator<DemoEvent, T | undefined> {
    yield { ...base, state: 'started' };
    try {
      const result = await work();
      yield { ...base, state: 'done', ...after(result) };
      return result;
    } catch (error) {
      if (error instanceof AllowanceRefused) {
        yield {
          ...base,
          state: 'refused',
          rule: error.rule,
          sub: refused?.(error.rule) ?? `refused by the contract: ${error.rule}`,
        };
        return undefined;
      }
      yield { ...base, state: 'failed', sub: error instanceof Error ? error.message : String(error) };
      throw error;
    }
  }

  try {
    yield* step(
      { id: 'fund', party: 'owner', title: 'Fund an owner', sub: 'friendbot' },
      () => deps.fund(owner.publicKey()),
      () => ({ amount: '10,000.00 XLM' }),
    );
    yield* step(
      { id: 'trustline', party: 'owner', title: 'Add the USDC trustline' },
      () => deps.trustline(owner),
      () => ({}),
    );
    yield* step(
      { id: 'swap', party: 'owner', title: 'Swap 100 XLM for USDC', sub: 'testnet DEX, strict send' },
      () => deps.swap(owner),
      (balance) => ({ amount: `${Number(balance).toFixed(4)} USDC` }),
    );

    const { url, wants } = await deps.seller();
    const price = BigInt(wants.amount);
    const each = `${usdc(price)} USDC`;

    const deployed = yield* step(
      {
        id: 'deploy',
        party: 'owner',
        title: 'Deploy the allowance',
        sub: `allowlist: the seller · cap ${usdc(WINDOW_CAP)} USDC per 24h · the agent's key ${short(agent.publicKey())} holds 0.000`,
      },
      () => deps.deploy(owner, agent, wants),
      (d) => ({ amount: `${usdc(DEPOSIT)} USDC in`, hash: d.id }),
    );
    if (!deployed) return;
    const allowance: Pair = { id: deployed.id, secret: agent.secret() };

    const first = yield* step(
      { id: 'pay-1', party: 'agent', title: 'Pay the seller', amount: each },
      () => deps.pay(allowance, url),
      (r) => ({ sub: 'settled by OpenZeppelin · the payer is the contract', hash: r.hash }),
    );
    if (!first) return;

    // Second, not last: the injection is the rule worth seeing, and a reader who stops early
    // should have seen it. It also costs nothing to run — the allowlist refuses at simulation.
    const stranger: Base = { id: 'stranger', party: 'agent', title: 'Prompt-injected to pay a stranger', amount: each };
    yield { ...stranger, state: 'started' };
    const refusal = await deps.refuse(allowance, wants);
    yield {
      ...stranger,
      state: 'refused',
      rule: refusal.rule,
      sub: 'not on the allowlist. Refused at simulation; nothing left the contract.',
    };

    // The rest of the window, one payment at a time, and then one payment past it. Every row
    // carries the running total rather than a position in a list, because the cap is what the
    // contract compares against and the count is not.
    for (let n = 2; n <= PAYMENTS + 1; n += 1) {
      const spent = usdc(price * BigInt(n));
      const beyond = n > PAYMENTS;
      const paid = yield* step(
        { id: `pay-${n}`, party: 'agent', title: 'Pay the seller', amount: each },
        () => deps.pay(allowance, url),
        (r) => ({ sub: `${spent} now in the window`, hash: r.hash }),
        () => `${spent} would exceed the ${usdc(WINDOW_CAP)} cap. Refused; nothing left the contract.`,
      );
      if (!paid && !beyond) return;
    }
  } catch {
    return;
  }
}
