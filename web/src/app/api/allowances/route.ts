import type { NextRequest } from 'next/server';
import { Address, StrKey, nativeToScVal } from '@stellar/stellar-sdk';
import { db } from '@/lib/supabase';
import { deployInstance } from '@/lib/deploy';
import { env } from '@/lib/env';
import { arg, read } from '@/lib/stellar';

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
  max_per_call?: string;
  window_ledgers?: number;
  window_cap?: string;
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

  const allowlist = (body.allowlist ?? []).filter((a) => a.startsWith('C'));
  if (allowlist.length === 0) {
    return Response.json({ error: 'allowlist must contain at least one contract' }, { status: 400 });
  }

  const maxPerCall = BigInt(body.max_per_call ?? '1000000');
  const windowCap = BigInt(body.window_cap ?? '5000000');
  const windowLedgers = Number(body.window_ledgers ?? 180);

  if (maxPerCall <= 0n || windowCap <= 0n || windowLedgers <= 0) {
    return Response.json({ error: 'limits must be positive' }, { status: 400 });
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

    await db().from('allowances').insert({
      contract_id: contractId,
      owner_address: owner,
      agent_address: agent,
    });

    return Response.json({ contract_id: contractId, owner, agent }, { status: 201 });
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
    .select('contract_id, owner_address, agent_address, created_at')
    .eq(owner ? 'owner_address' : 'agent_address', address)
    .order('created_at', { ascending: false });

  const rows = data ?? [];

  // Read each one off the chain. Best effort per row: a contract that has been archived out of
  // the ledger should leave the others listable rather than failing the whole lookup.
  const detailed = await Promise.all(
    rows.map(async (row) => {
      try {
        const [balance, rules, revoked] = await Promise.all([
          read(row.contract_id, 'balance'),
          read(row.contract_id, 'config'),
          read(row.contract_id, 'revoked'),
        ]);
        return {
          ...row,
          balance: String(balance ?? 0),
          revoked: Boolean(revoked),
          rules: {
            max_per_call: String((rules as Rules).max_per_call),
            window_cap: String((rules as Rules).window_cap),
            window_ledgers: Number((rules as Rules).window_ledgers),
            allowlist: ((rules as Rules).allowlist ?? []).map(String),
          },
        };
      } catch {
        return { ...row, balance: null, revoked: null, rules: null };
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

type Rules = {
  max_per_call: bigint;
  window_cap: bigint;
  window_ledgers: number;
  allowlist: unknown[];
};
