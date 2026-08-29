import { randomBytes } from 'node:crypto';
import {
  Account,
  Keypair,
  Operation,
  StrKey,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { db } from './supabase';
import { env } from './env';

/**
 * Proving an address is yours, without a password or a session.
 *
 * The developer surface used to be open, because nothing on it could be changed. A dashboard
 * changes that — a price, an upstream URL and a handle are all editable — and "anyone can edit
 * anyone's API" is not a property this project should have.
 *
 * The proof is a **challenge transaction**, the shape SEP-10 uses. The server builds a
 * transaction the account could never actually submit, the wallet signs it, and the server
 * checks the signature. Nothing is stored that could be replayed: the nonce inside is
 * single-use and expires in five minutes.
 *
 * It signs a transaction rather than a message on purpose, and the first attempt did the
 * opposite. Freighter's `signMessage` hands the text to its extension as a blob and the
 * extension signs *something* — forty-eight reconstructions of that payload all failed to
 * verify, and guessing a forty-ninth is not a method. A transaction has one canonical hash that
 * both sides compute with the same library, so there is no encoding to guess at. It is also the
 * path this app already uses for deposits and rule changes, which is known to work.
 *
 * `auth_challenges` has been in the schema since migration 0001, described exactly this way,
 * and nothing ever wrote a row to it.
 */

const NONCE_TTL_SECONDS = 300;

/** Names the operation so a wallet shows what is being asked, and so we can recognise it back. */
const PURPOSE = 'stellar-allowance auth';

/**
 * A transaction that cannot be submitted, ever.
 *
 * Sequence zero is the trick SEP-10 relies on: a real transaction must use the account's next
 * sequence number, and zero never is one. So this can be signed safely — there is no state in
 * which the network would accept it — and it carries no operation that moves anything.
 */
function challengeTransaction(address: string, nonce: string, expiresAt: Date) {
  // "-1" so the builder increments to zero.
  const account = new Account(address, '-1');

  return new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: env.networkPassphrase(),
  })
    .addOperation(
      Operation.manageData({
        name: PURPOSE,
        value: nonce,
        source: address,
      }),
    )
    // Timebounds from the stored expiry, never from "now". `setTimeout` bakes the current clock
    // into the transaction, so rebuilding it a second later produced a different hash and the
    // signature stopped matching — a failure that looked exactly like a forgery and appeared
    // only when issuing and verifying happened to straddle a second.
    .setTimebounds(0, Math.floor(expiresAt.getTime() / 1000))
    .build();
}

export async function issueChallenge(address: string) {
  const nonce = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + NONCE_TTL_SECONDS * 1000);

  await db().from('auth_challenges').insert({
    nonce,
    address,
    expires_at: expiresAt.toISOString(),
  });

  return {
    nonce,
    transaction: challengeTransaction(address, nonce, expiresAt).toXDR(),
    network_passphrase: env.networkPassphrase(),
    expires_at: expiresAt.toISOString(),
  };
}

export type ProofFailure =
  | 'not_an_address'
  | 'unknown_nonce'
  | 'wrong_address'
  | 'already_used'
  | 'expired'
  | 'not_the_challenge'
  | 'bad_signature';

/**
 * Checks a signed challenge and burns the nonce.
 *
 * The nonce is consumed whether or not the signature checks out. One that survived a failed
 * attempt could be guessed against for the rest of its five minutes, and issuing another costs
 * nothing.
 */
export async function verifyProof(proof: {
  address?: string;
  nonce?: string;
  signed?: string;
}): Promise<{ ok: true; address: string } | { ok: false; reason: ProofFailure }> {
  const { address, nonce, signed } = proof;

  if (!address || !StrKey.isValidEd25519PublicKey(address)) {
    return { ok: false, reason: 'not_an_address' };
  }
  if (!nonce || !signed) return { ok: false, reason: 'unknown_nonce' };

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

  // Rebuilt here rather than trusted from the wire. What comes back only has to carry a valid
  // signature over the transaction *we* composed — so a wallet returning some other transaction,
  // signed perfectly, proves nothing and is refused.
  const expected = challengeTransaction(address, nonce, new Date(challenge.expires_at));

  try {
    const returned = TransactionBuilder.fromXDR(signed, env.networkPassphrase());
    if (returned.hash().toString('hex') !== expected.hash().toString('hex')) {
      return { ok: false, reason: 'not_the_challenge' };
    }

    const key = Keypair.fromPublicKey(address);
    const hash = expected.hash();
    const verified = returned.signatures.some((signature) => {
      try {
        return key.verify(hash, signature.signature());
      } catch {
        return false;
      }
    });

    return verified ? { ok: true, address } : { ok: false, reason: 'bad_signature' };
  } catch {
    return { ok: false, reason: 'bad_signature' };
  }
}
