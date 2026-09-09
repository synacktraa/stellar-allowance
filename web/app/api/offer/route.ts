import { decodePaymentRequiredHeader } from '@x402/core/http';
import { pickOffer, type Resolution } from '@/lib/x402/offer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TIMEOUT_MS = 8_000;

// Sellers send no cross-origin headers, so a browser cannot read a 402 for itself. This asks on
// its behalf and hands back the one thing the allowlist needs. It holds no keys, signs nothing,
// and pays nothing: the request it makes is the same unpaid GET anyone can make.
export async function POST(request: Request): Promise<Response> {
  let url: string;
  try {
    ({ url } = (await request.json()) as { url: string });
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('only http and https');
    }
  } catch {
    return answer({ ok: false, reason: 'that is not a URL' });
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: '*/*' },
    });
  } catch {
    return answer({ ok: false, reason: 'nothing answered at that URL' });
  }

  const header = response.headers.get('payment-required');
  if (!header) {
    return answer({
      ok: false,
      reason:
        response.status === 402
          ? 'it asks for payment in a way this does not understand'
          : 'this URL does not ask for payment',
    });
  }

  try {
    return answer(pickOffer(url, decodePaymentRequiredHeader(header)));
  } catch {
    return answer({ ok: false, reason: 'its payment terms could not be read' });
  }
}

const answer = (resolution: Resolution) =>
  Response.json(
    resolution.ok ? { ...resolution, offer: { ...resolution.offer, amount: String(resolution.offer.amount) } } : resolution,
    { headers: { 'cache-control': 'no-store' } },
  );
