import type { NextRequest } from 'next/server';
import { Address, Horizon, StrKey, nativeToScVal } from '@stellar/stellar-sdk';
import { db } from '@/lib/supabase';
import { deployInstance } from '@/lib/deploy';
import { env } from '@/lib/env';
import { arg, read } from '@/lib/stellar';
import { DEFAULT_WINDOW_LEDGERS, LEDGERS_PER_MINUTE, NO_RATE_LIMIT } from '@/lib/rules';

/**
 * Creating an allowance.
 *
 * The platform deploys and pays, and the constructor names the user as owner in the same
 * transaction. The user never has to acquire XLM before they can own anything, and still owns
 * the result outright: we cannot spend from it, change its rules, or take it back.
 *
 * This is why the contract has a constructor rather than an `init` function. A separate call
 * would need the owner's signature to prove they wanted to be the owner, which puts the XLM
 * barrier straight back, and would leave the contract briefly unowned in between.
 *
 * Every later owner action — deposit, set_rules, revoke, withdraw — is signed by the user in
 * their own wallet. The platform can only create it.
 */

export const maxDuration = 60;

type Body = {
  owner?: string;
  agent?: string;
  name?: string;
  /** Absent means no rate limit, and then the balance in the contract is the limit. */
  window_cap?: string;
  window_minutes?: number;
  allowlist?: string[];
};

export async function POST(request: NextRequest) {
  const body: Body = await request.json();

  const owner = body.owner?.trim();
  const agent = body.agent?.trim();

  if (!owner || !StrKey.isValidEd25519PublicKey(owner)) {
    return Response.json({ error: 'owner must be a Stellar account address' }, { status: 400 });
  }
  if (!agent || !StrKey.isValidEd25519PublicKey(agent)) {
    return Response.json({ error: 'agent must be a Stellar account address' }, { status: 400 });
  }

  const name = body.name?.trim();
  if (!name || !/^[A-Za-z0-9][A-Za-z0-9 _-]{0,31}$/.test(name)) {
    return Response.json(
      { error: 'name must be 1-32 characters: letters, digits, spaces, underscore or hyphen.' },
      { status: 400 },
    );
  }

  // An empty allowlist refuses everything, so an agent created without one is dead on arrival —
  // and deciding who may be paid is the protection this product leads with.
  const allowlist = (body.allowlist ?? []).filter((a) => a.startsWith('C'));
  if (allowlist.length === 0) {
    return Response.json(
      { error: 'Choose at least one API this agent may pay.' },
      { status: 400 },
    );
  }

  // No rate limit unless one is asked for. The contract needs a number either way, so "none" is
  // a cap nothing reaches rather than a special case in the contract.
  const windowCap = body.window_cap ? BigInt(body.window_cap) : NO_RATE_LIMIT;
  const windowLedgers = body.window_minutes
    ? Math.max(1, Math.round(Number(body.window_minutes) * LEDGERS_PER_MINUTE))
    : DEFAULT_WINDOW_LEDGERS;

  // The per-call cap is not a separate idea any more: a single call may spend whatever the
  // window allows, and no more.
  const maxPerCall = windowCap;

  if (windowCap <= 0n) {
    return Response.json({ error: 'the cap must be positive' }, { status: 400 });
  }

  try {
    // Deploy and configure in one transaction. The owner is set atomically, so there is no
    // moment where the contract exists unowned, and the owner never needs XLM to claim it.
    const contractId = await deployInstance(env.allowanceWasmHash(), [
      arg.address(owner),
      arg.address(env.usdcSac()),
      arg.address(agent),
      nativeToScVal(
        {
          max_per_call: maxPerCall,
          window_ledgers: windowLedgers,
          window_cap: windowCap,
          allowlist: allowlist.map((a) => Address.fromString(a)),
        },
        {
          type: {
            max_per_call: ['symbol', 'i128'],
            window_ledgers: ['symbol', 'u32'],
            window_cap: ['symbol', 'i128'],
            allowlist: ['symbol', null],
          },
        },
      ),
    ]);

    const { error } = await db().from('allowances').insert({
      contract_id: contractId,
      owner_address: owner,
      agent_address: agent,
      name,
    });

    if (error) {
      // The contract is deployed and owned either way — losing the row would be worse than a
      // duplicate name, so this reports rather than unwinding anything.
      return Response.json(
        { contract_id: contractId, owner, agent, warning: `You already have an agent called ${name}.` },
        { status: 201 },
      );
    }

    return Response.json({ contract_id: contractId, owner, agent, name }, { status: 201 });
  } catch (cause) {
    return Response.json(
      { error: cause instanceof Error ? cause.message : String(cause) },
      { status: 502 },
    );
  }
}

/**
 * Look up allowances by owner or by agent.
 *
 * By agent matters for tooling: an agent knows its own key and nothing else, so this is how a
 * script finds which allowance it is allowed to ask, without anyone pasting a contract id.
 *
 * Each row carries its balance, rules and the names of the APIs it may pay. A list of contract
 * ids identifies nothing to a person — `CBJNXCGG…42FF` is not a thing anyone recognises, and
 * choosing between two of them is guesswork. What distinguishes one allowance from another is
 * what it can buy, what is in it, and what it is capped at.
 */
export async function GET(request: NextRequest) {
  const owner = request.nextUrl.searchParams.get('owner');
  const agent = request.nextUrl.searchParams.get('agent');

  const address = owner ?? agent;
  if (!address || !StrKey.isValidEd25519PublicKey(address)) {
    return Response.json({ error: 'owner or agent query parameter is required' }, { status: 400 });
  }

  const { data } = await db()
    .from('allowances')
    .select('contract_id, owner_address, agent_address, name, created_at')
    .eq(owner ? 'owner_address' : 'agent_address', address)
    .order('created_at', { ascending: false });

  const rows = data ?? [];

  // Read each one off the chain. Best effort per row: a contract that has been archived out of
  // the ledger should leave the others listable rather than failing the whole lookup.
  const detailed = await Promise.all(
    rows.map(async (row) => {
      try {
        const [balance, rules, revoked, xlm] = await Promise.all([
          read(row.contract_id, 'balance'),
          read(row.contract_id, 'config'),
          read(row.contract_id, 'revoked'),
          // The agent's own XLM, which pays its transaction fees. Nothing to do with the money
          // it can spend — but an agent that runs out of it stops working, and that failure
          // looks like a refusal unless the number is somewhere visible.
          agentXlm(row.agent_address),
        ]);
        return {
          ...row,
          balance: String(balance ?? 0),
          xlm,
          revoked: Boolean(revoked),
          rules: {
            max_per_call: String((rules as Rules).max_per_call),
            window_cap: String((rules as Rules).window_cap),
            window_ledgers: Number((rules as Rules).window_ledgers),
            allowlist: ((rules as Rules).allowlist ?? []).map(String),
          },
        };
      } catch {
        return { ...row, balance: null, xlm: null, revoked: null, rules: null };
      }
    }),
  );

  // Turn the allowlisted splitter addresses into the API names a person would recognise.
  const splitters = [...new Set(detailed.flatMap((row) => row.rules?.allowlist ?? []))];
  const names = new Map<string, string>();

  if (splitters.length > 0) {
    const { data: apis } = await db()
      .from('apis')
      .select('name, splitter_contract_id')
      .in('splitter_contract_id', splitters);

    for (const api of apis ?? []) {
      if (api.splitter_contract_id) names.set(api.splitter_contract_id, api.name);
    }
  }

  const allowances = detailed.map((row) => ({
    ...row,
    // Anything without a name is an address allowlisted directly rather than picked from the
    // directory — still worth listing, since it still gets paid.
    can_pay: (row.rules?.allowlist ?? []).map(
      (id) => names.get(id) ?? `${id.slice(0, 6)}…${id.slice(-4)}`,
    ),
  }));

  return Response.json({ allowances });
}

/** Best effort: an agent account that does not exist yet simply has none. */
async function agentXlm(address: string): Promise<number | null> {
  try {
    const account = await new Horizon.Server(env.horizonUrl()).loadAccount(address);
    const native = account.balances.find((b) => b.asset_type === 'native');
    return native ? Number(native.balance) : 0;
  } catch {
    return null;
  }
}

type Rules = {
  max_per_call: bigint;
  window_cap: bigint;
  window_ledgers: number;
  allowlist: unknown[];
};
