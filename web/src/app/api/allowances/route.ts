import type { NextRequest } from 'next/server';
import { Address, StrKey, nativeToScVal } from '@stellar/stellar-sdk';
import { db } from '@/lib/supabase';
import { deployInstance } from '@/lib/deploy';
import { env } from '@/lib/env';
import { arg } from '@/lib/stellar';

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

  return Response.json({ allowances: data ?? [] });
}
