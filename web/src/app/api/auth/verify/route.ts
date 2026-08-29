import type { NextRequest } from 'next/server';
import { verifyProof } from '@/lib/auth';

/**
 * Checks a signature over a nonce, and says so.
 *
 * Nothing is granted here — no cookie, no token, no session. Every action that needs proof
 * carries its own, because a session would be a thing that could be stolen and this way there
 * is nothing to steal. The route exists so the proof can be exercised on its own, which is what
 * the tests do.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    return Response.json(await verifyProof(await request.json()));
  } catch {
    return Response.json({ ok: false, reason: 'not_an_address' }, { status: 400 });
  }
}
