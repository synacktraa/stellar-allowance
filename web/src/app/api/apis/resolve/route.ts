import type { NextRequest } from 'next/server';
import { db } from '@/lib/supabase';

/**
 * A paid URL in, the address a payment to it would land on out.
 *
 * The allowance stores addresses, because an address is all a contract can check — it has no
 * network access and could never resolve a URL. But nobody is handed an address. What a
 * developer gives their customer is the URL to call, so that is what the page asks for, and the
 * reconciliation happens here rather than in the owner's head.
 *
 * This replaces a list of every registered API with checkboxes beside it. Registration is open
 * and free, so anyone can appear in that list looking exactly like everybody else — and
 * presenting it as a menu implied a vetting nobody performs. There is no way to tell "an API I
 * meant to use" from "an API someone registered to be paid by mistake" except the owner's own
 * intent, and intent arrives with the URL.
 */

export const dynamic = 'force-dynamic';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Api = {
  id: string;
  name: string;
  price_stroops: string;
  splitter_contract_id: string | null;
  status: string;
};

/**
 * Pulls the API's id out of whatever was pasted.
 *
 * Only the id is used, not the host: the id is ours either way, and a URL copied from a local
 * dev server or a preview deployment names the same API as one copied from production. What
 * comes back carries the canonical URL, so the owner sees which one they actually resolved.
 */
function identify(input: string): string | null {
  const trimmed = input.trim();
  if (ID.test(trimmed)) return trimmed.toLowerCase();

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const last = url.pathname.split('/').filter(Boolean).pop() ?? '';
  return ID.test(last) ? last.toLowerCase() : null;
}

export async function GET(request: NextRequest) {
  const input = request.nextUrl.searchParams.get('url') ?? '';
  const id = identify(input);

  if (!id) {
    return Response.json(
      { error: 'That does not look like a paid URL. Paste the link the API gave you.' },
      { status: 400 },
    );
  }

  const { data: api } = await db()
    .from('apis')
    .select('id, name, price_stroops, splitter_contract_id, status')
    .eq('id', id)
    .maybeSingle<Api>();

  // Refused loudly. An allowance that quietly failed to add an API looks fine until a purchase
  // is refused days later with an error about the recipient, and by then nothing connects the
  // two events.
  if (!api || api.status !== 'active' || !api.splitter_contract_id) {
    return Response.json(
      { error: 'No API answers at that URL. Check it with whoever gave it to you.' },
      { status: 404 },
    );
  }

  return Response.json({
    id: api.id,
    name: api.name,
    price_stroops: api.price_stroops,
    splitter_contract_id: api.splitter_contract_id,
    paid_url: `${request.nextUrl.origin}/api/pay/${api.id}`,
  });
}
