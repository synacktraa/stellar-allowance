import type { NextRequest } from 'next/server';
import { StrKey } from '@stellar/stellar-sdk';
import { db } from '@/lib/supabase';
import { verifyProof } from '@/lib/auth';

/**
 * A handle for a wallet address.
 *
 * An agent owner allowlisting an API is making a decision about *who* they are paying, and until
 * now we showed them nothing but a contract address. `@alice` is information; `GCI5EACH…` is not.
 *
 * It is a name someone picked and nobody verified, which is why it is only ever rendered as
 * `@handle` — the shape people already read as self-chosen. First come, first served: the
 * alternative is us adjudicating who is really who, which is precisely the vetting this project
 * declines to pretend to do.
 *
 * Claiming one needs a signature, because it is a write against somebody else's address
 * otherwise.
 */

export const dynamic = 'force-dynamic';

const HANDLE = /^[a-z0-9][a-z0-9_-]{2,19}$/;

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get('address');
  if (!address || !StrKey.isValidEd25519PublicKey(address)) {
    return Response.json({ error: 'address must be a Stellar account address.' }, { status: 400 });
  }

  const { data } = await db()
    .from('developers')
    .select('address, username')
    .eq('address', address)
    .maybeSingle<{ address: string; username: string | null }>();

  // Not an error — "no handle yet" is the normal state of a wallet arriving for the first time,
  // and the page needs to tell them apart from a failure.
  return Response.json({ address, username: data?.username ?? null });
}

export async function POST(request: NextRequest) {
  let body: { address?: string; nonce?: string; signature?: string; username?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Body must be JSON.' }, { status: 400 });
  }

  const proof = await verifyProof(body);
  if (!proof.ok) {
    return Response.json({ error: `Could not prove that address: ${proof.reason}.` }, { status: 401 });
  }

  const username = body.username?.trim().toLowerCase() ?? '';
  if (!HANDLE.test(username)) {
    return Response.json(
      {
        error:
          'A handle is 3 to 20 characters: lowercase letters, digits, underscore or hyphen, ' +
          'starting with a letter or digit.',
      },
      { status: 400 },
    );
  }

  const supabase = db();

  // One handle per address, and it does not change. A handle that moved would make every
  // "@alice/weather" anyone had written down point somewhere new.
  const { data: existing } = await supabase
    .from('developers')
    .select('username')
    .eq('address', proof.address)
    .maybeSingle<{ username: string | null }>();

  if (existing?.username && existing.username !== username) {
    return Response.json(
      { error: `That address is already @${existing.username}.` },
      { status: 409 },
    );
  }

  const { error } = await supabase
    .from('developers')
    .upsert({ address: proof.address, username }, { onConflict: 'address' });

  if (error) {
    // The unique index is the only thing that can decide a race between two people claiming the
    // same handle, so the answer comes from it rather than from a check we did a moment ago.
    return Response.json({ error: `@${username} is taken.` }, { status: 409 });
  }

  return Response.json({ address: proof.address, username });
}
