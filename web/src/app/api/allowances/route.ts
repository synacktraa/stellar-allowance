import type { NextRequest } from 'next/server';
import { Horizon, StrKey } from '@stellar/stellar-sdk';
import { db } from '@/lib/supabase';
import { env } from '@/lib/env';
import { read } from '@/lib/stellar';

/**
 * Recording an allowance the owner has already deployed.
 *
 * This used to deploy the contract itself, on the platform's account and at the platform's
 * expense. It no longer does. The owner's wallet builds and signs the deploy, because a deploy
 * runs its constructor in the same invocation — which is what lets one confirmation create the
 * contract, name the agent, set the rules, move the USDC in and fund the agent's account. When
 * the platform deployed first, funding it was necessarily a second confirmation, and the second
 * one is the one people forget.
 *
 * So the contract already exists by the time this is called, and every fact about it is already
 * on the chain. What is stored here is only the human part — a name — plus the index that makes
 * `?owner=` and `?agent=` lookups possible without scanning the ledger.
 *
 * **It is verified before it is believed.** The contract is asked who owns it and which agent it
 * names, and both must match what the caller claims. Without that, anyone could post any string
 * and attach rows to other people's addresses.
 *
 * Deliberately unsigned. Requiring a challenge signature would mean a second Freighter prompt
 * during creation, which is the exact thing this change exists to remove — and it is safe to
 * skip precisely because **nothing in this request is the caller's to choose**. The owner, the
 * agent and the contract are all checked against the chain, and the name is assigned here. A
 * racing attacker could only create the identical row the owner was about to.
 *
 * The name is therefore a placeholder. Renaming is a separate, signed request, which is where
 * a caller-chosen string belongs.
 */
export const maxDuration = 60;

type Body = {
  owner?: string;
  agent?: string;
  contract_id?: string;
};

export async function POST(request: NextRequest) {
  const body: Body = await request.json();

  const owner = body.owner?.trim();
  const agent = body.agent?.trim();
  const contractId = body.contract_id?.trim();

  if (!owner || !StrKey.isValidEd25519PublicKey(owner)) {
    return Response.json({ error: 'owner must be a Stellar account address' }, { status: 400 });
  }
  if (!agent || !StrKey.isValidEd25519PublicKey(agent)) {
    return Response.json({ error: 'agent must be a Stellar account address' }, { status: 400 });
  }
  if (!contractId || !StrKey.isValidContract(contractId)) {
    return Response.json({ error: 'contract_id must be a contract address' }, { status: 400 });
  }
  // Ask the contract itself. Anything the caller says about it is a claim until this agrees.
  let claimedBy: string;
  let names: string;
  try {
    const [onChainOwner, onChainAgent] = await Promise.all([
      read(contractId, 'owner'),
      read(contractId, 'agent'),
    ]);
    claimedBy = String(onChainOwner);
    names = String(onChainAgent);
  } catch {
    return Response.json(
      { error: 'No allowance at that address. Was the deploy submitted?' },
      { status: 404 },
    );
  }

  if (claimedBy !== owner) {
    return Response.json({ error: 'That allowance belongs to somebody else.' }, { status: 403 });
  }
  if (names !== agent) {
    return Response.json(
      { error: 'That allowance names a different agent.' },
      { status: 400 },
    );
  }

  const name = await placeholderName(owner);

  const { error } = await db().from('allowances').insert({
    contract_id: contractId,
    owner_address: owner,
    agent_address: agent,
    name,
  });

  if (error) {
    // Already recorded. The contract exists and is theirs either way, so this is not a failure
    // worth showing anyone — it is the second click of a button that already worked.
    return Response.json({ contract_id: contractId, owner, agent, recorded: false }, { status: 200 });
  }

  return Response.json({ contract_id: contractId, owner, agent, name }, { status: 201 });
}

/**
 * The lowest `allowance-N` this owner is not already using.
 *
 * Names are unique per owner, so this cannot simply count rows: an owner who renamed their first
 * allowance to `allowance-2` would collide with the next one created. Asking which are taken is
 * one query and has no such gap.
 */
async function placeholderName(owner: string): Promise<string> {
  const { data } = await db().from('allowances').select('name').eq('owner_address', owner);
  const taken = new Set((data ?? []).map((row) => row.name));

  for (let n = 1; n <= taken.size + 1; n += 1) {
    const candidate = `allowance-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  // Unreachable: n only has to exceed the number of taken names to find a gap.
  return `allowance-${taken.size + 1}`;
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
