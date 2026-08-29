import type { NextRequest } from 'next/server';
import { StrKey } from '@stellar/stellar-sdk';
import { issueChallenge } from '@/lib/auth';

/**
 * Hands out a nonce to sign.
 *
 * Deliberately open: a nonce is worthless without the key that signs it, and refusing to issue
 * one to an address you do not own protects nothing. What matters is that it is single-use and
 * short-lived, which `verifyProof` enforces.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  let address: string | undefined;
  try {
    ({ address } = await request.json());
  } catch {
    return Response.json({ error: 'Body must be JSON.' }, { status: 400 });
  }

  if (!address || !StrKey.isValidEd25519PublicKey(address)) {
    return Response.json({ error: 'address must be a Stellar account address.' }, { status: 400 });
  }

  return Response.json(await issueChallenge(address));
}
