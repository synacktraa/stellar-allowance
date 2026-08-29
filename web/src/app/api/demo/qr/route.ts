import type { NextRequest } from 'next/server';
import QRCode from 'qrcode';
import { db } from '@/lib/supabase';

/**
 * The API this project sells in its own demo.
 *
 * Everything here is computed locally. That is the point: a demo that called somebody else's
 * service would be down whenever they were, and the landing page runs this on every visit.
 * A QR encoder is pure arithmetic, so there is nothing to be down.
 *
 * It answers both shapes a paid API needs. Short input fits in a query string; a vCard, a WiFi
 * config or a long URL does not, and goes in a POST body. Options ride along either way.
 */

// Well beyond what a QR code can hold, so the encoder's own limit is what reports the failure
// and says which version and error-correction level it ran out at.
const MAX_TEXT = 4000;

const ECC = ['L', 'M', 'Q', 'H'] as const;
type Ecc = (typeof ECC)[number];

type Input = { text?: string; size?: number | string; ecc?: string; format?: string };

function bad(detail: string) {
  return Response.json({ error: detail }, { status: 400 });
}

/**
 * Only the gateway may call this.
 *
 * Without it there is no reason to pay: the endpoint would answer anyone who found the URL,
 * and the 402 in front of it would be decoration. The gateway sends each API's own
 * `upstream_secret`, so a valid one proves the call arrived through a paid route.
 */
async function throughTheGateway(request: NextRequest): Promise<boolean> {
  const secret = request.headers.get('x-allowance-secret');
  if (!secret) return false;

  const { data } = await db()
    .from('apis')
    .select('id')
    .eq('upstream_secret', secret)
    .eq('status', 'active')
    .maybeSingle<{ id: string }>();

  return Boolean(data);
}

function clamp(value: unknown, fallback: number, low: number, high: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(high, Math.max(low, Math.round(n)));
}

async function encode(input: Input) {
  const text = typeof input.text === 'string' ? input.text : '';
  if (!text) return bad('text is required — give it something to encode.');
  if (text.length > MAX_TEXT) {
    return bad(`text is ${text.length} characters; the maximum is ${MAX_TEXT}.`);
  }

  const size = clamp(input.size, 300, 64, 1000);
  const ecc = (ECC as readonly string[]).includes(String(input.ecc).toUpperCase())
    ? (String(input.ecc).toUpperCase() as Ecc)
    : 'M';
  const format = input.format === 'svg' ? 'svg' : 'json';

  let svg: string;
  let modules: number;
  try {
    svg = await QRCode.toString(text, {
      type: 'svg',
      errorCorrectionLevel: ecc,
      width: size,
      margin: 1,
    });
    modules = QRCode.create(text, { errorCorrectionLevel: ecc }).modules.size;
  } catch (cause) {
    // Almost always "too big for any version at this error-correction level", which is the
    // caller's problem to fix and worth saying plainly rather than as a 500.
    return bad(cause instanceof Error ? cause.message : 'could not encode that.');
  }

  // Raw SVG for anyone putting it straight in an <img>; JSON by default, because it carries
  // back what was encoded and a caller usually wants to check that before trusting the image.
  if (format === 'svg') {
    return new Response(svg, {
      headers: { 'content-type': 'image/svg+xml; charset=utf-8' },
    });
  }

  return Response.json({ text, size, ecc, format: 'svg', modules, svg });
}

export async function GET(request: NextRequest) {
  if (!(await throughTheGateway(request))) {
    return Response.json({ error: 'This API is sold through the gateway.' }, { status: 401 });
  }

  const query = request.nextUrl.searchParams;
  return encode({
    text: query.get('text') ?? undefined,
    size: query.get('size') ?? undefined,
    ecc: query.get('ecc') ?? undefined,
    format: query.get('format') ?? undefined,
  });
}

export async function POST(request: NextRequest) {
  if (!(await throughTheGateway(request))) {
    return Response.json({ error: 'This API is sold through the gateway.' }, { status: 401 });
  }

  let body: Input;
  try {
    body = await request.json();
  } catch {
    return bad('Body must be JSON.');
  }

  return encode(body);
}
