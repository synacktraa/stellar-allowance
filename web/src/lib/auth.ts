import { randomBytes } from 'node:crypto';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { db } from './supabase';

/**
 * Proving an address is yours, without a password or a session.
 *
 * The developer surface used to be open, because nothing on it could be changed: APIs were
 * listed by `?developer=<address>` and that was all. A dashboard changes that — a price, an
 * upstream URL and a handle are all editable, and "anyone can edit anyone's API" is not a
 * property this project should have.
 *
 * There is no account to log into. The only thing a developer has is a Stellar keypair, so the
 * proof is a signature over a nonce we issued: we hand out a string, they sign it with the key
 * that owns the address, and we check it. Nothing is stored that could be stolen and replayed —
 * a nonce is single-use and expires in five minutes.
 *
 * `auth_challenges` has been in the schema since migration 0001, described exactly this way, and
 * nothing ever wrote a row to it.
 */

const NONCE_TTL_SECONDS = 300;

/**
 * What the wallet actually shows the person signing.
 *
 * A bare nonce in a signing prompt is a string of noise, and approving noise is a habit worth
 * not teaching. This says who is asking and what for, and the server rebuilds it from the stored
 * nonce rather than trusting the client to send the same text back.
 */
export function messageFor(address: string, nonce: string): string {
  return [
    'Stellar Allowance',
    '',
    'Prove this address is yours. This is a signature, not a transaction:',
    'it moves no money and costs nothing.',
    '',
    `address: ${address}`,
    `nonce:   ${nonce}`,
  ].join('\n');
}

export async function issueChallenge(address: string) {
  const nonce = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + NONCE_TTL_SECONDS * 1000);

  await db().from('auth_challenges').insert({
    nonce,
    address,
    expires_at: expiresAt.toISOString(),
  });

  return { nonce, message: messageFor(address, nonce), expires_at: expiresAt.toISOString() };
}

export type ProofFailure =
  | 'not_an_address'
  | 'unknown_nonce'
  | 'wrong_address'
  | 'already_used'
  | 'expired'
  | 'bad_signature';

/**
 * Checks a signature and burns the nonce.
 *
 * The nonce is consumed whether or not the signature checks out. A nonce that survived a failed
 * attempt would let someone keep guessing against it, and there is no cost to issuing another.
 */
export async function verifyProof(proof: {
  address?: string;
  nonce?: string;
  signature?: string;
}): Promise<{ ok: true; address: string } | { ok: false; reason: ProofFailure }> {
  const { address, nonce, signature } = proof;

  if (!address || !StrKey.isValidEd25519PublicKey(address)) {
    return { ok: false, reason: 'not_an_address' };
  }
  if (!nonce || !signature) return { ok: false, reason: 'unknown_nonce' };

  const supabase = db();
  const { data: challenge } = await supabase
    .from('auth_challenges')
    .select('nonce, address, expires_at, used_at')
    .eq('nonce', nonce)
    .maybeSingle<{ nonce: string; address: string; expires_at: string; used_at: string | null }>();

  if (!challenge) return { ok: false, reason: 'unknown_nonce' };
  if (challenge.used_at) return { ok: false, reason: 'already_used' };

  await supabase
    .from('auth_challenges')
    .update({ used_at: new Date().toISOString() })
    .eq('nonce', nonce);

  if (challenge.address !== address) return { ok: false, reason: 'wrong_address' };
  if (new Date(challenge.expires_at) < new Date()) return { ok: false, reason: 'expired' };

  try {
    const verified = Keypair.fromPublicKey(address).verify(
      Buffer.from(messageFor(address, nonce), 'utf8'),
      Buffer.from(signature, 'base64'),
    );
    return verified ? { ok: true, address } : { ok: false, reason: 'bad_signature' };
  } catch {
    return { ok: false, reason: 'bad_signature' };
  }
}
