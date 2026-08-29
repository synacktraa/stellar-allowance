import { timingSafeEqual } from 'node:crypto';

/**
 * The demo routes spend real testnet USDC on every call.
 *
 * They used to be public, because the landing page called them directly — which meant anyone
 * who read the network tab could drain the demo by POSTing in a loop. Now the page replays a
 * recording and these routes exist only to make that recording, so they answer one caller.
 *
 * Fails closed: with no secret configured, nobody is the recorder.
 */
export function isRecorder(request: Request): boolean {
  const expected = process.env.DEMO_RECORDER_SECRET;
  if (!expected) return false;

  const offered = request.headers.get('x-demo-recorder');
  if (!offered) return false;

  const a = Buffer.from(offered);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, which would itself leak the length.
  return a.length === b.length && timingSafeEqual(a, b);
}
