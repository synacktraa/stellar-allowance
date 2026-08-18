import { randomBytes } from 'node:crypto';

/**
 * A challenge reference.
 *
 * Two formats constrain the length:
 *
 *   - Soroban `Symbol`, because it is passed into `spend()` — at most 32 characters, [a-zA-Z0-9_].
 *   - `MEMO_TEXT`, because an agent paying directly (with no allowance) carries the reference in
 *     the transaction memo instead — at most **28 bytes**.
 *
 * 28 is the binding limit. A hex-encoded 32 bytes would be 64 characters and fits neither, hence
 * base62 over random bytes.
 *
 * 28 characters of base62 is around 166 bits, far more than needed. The requirement is only that
 * it cannot be guessed: a payment proves purchase precisely because the payer had to know a
 * reference nobody else could produce.
 */

const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const LENGTH = 28;

export function newReference(): string {
  const bytes = randomBytes(LENGTH);
  let out = '';
  for (let i = 0; i < LENGTH; i += 1) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

const VALID = /^[A-Za-z0-9_]{1,28}$/;

export function isValidReference(value: unknown): value is string {
  return typeof value === 'string' && VALID.test(value);
}
