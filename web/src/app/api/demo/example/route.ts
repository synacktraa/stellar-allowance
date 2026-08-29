import { db } from '@/lib/supabase';
import { env } from '@/lib/env';

/**
 * The one API this platform will vouch for, because it is ours.
 *
 * Somebody arriving with no URL from anybody has nothing to paste, and an empty box is a dead
 * end. Offering our own demo API is not the list this replaced: it is a single, named,
 * self-declared example rather than a directory of strangers presented as equals.
 */

export const dynamic = 'force-dynamic';

export async function GET() {
  const id = process.env.DEMO_API_ID;
  if (!id) return Response.json({ error: 'no demo API configured' }, { status: 404 });

  const { data } = await db()
    .from('apis')
    .select('id, name, price_stroops, developer_address, status')
    .eq('id', id)
    .maybeSingle<{
      id: string;
      name: string;
      price_stroops: string;
      developer_address: string;
      status: string;
    }>();

  if (!data || data.status !== 'active') {
    return Response.json({ error: 'no demo API configured' }, { status: 404 });
  }

  // Only offered when we are genuinely its developer. Pointing people at somebody else's API as
  // "ours" would be exactly the implied endorsement this whole change removes.
  if (data.developer_address !== env.platformAddress()) {
    return Response.json({ error: 'the demo API is not ours to vouch for' }, { status: 404 });
  }

  return Response.json({
    id: data.id,
    name: data.name,
    price_stroops: data.price_stroops,
    paid_url: `/api/pay/${data.id}`,
  });
}
