import { runDemo } from '@/lib/demo/run';
import { liveDeps } from '@/lib/demo/live';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let running = false;

// One run at a time per instance. Every key is generated inside the run and discarded with it.
export async function GET(): Promise<Response> {
  if (running) return new Response('a run is already in progress', { status: 429 });
  running = true;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of runDemo(liveDeps())) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
        controller.enqueue(encoder.encode('event: end\ndata: {}\n\n'));
      } finally {
        running = false;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}
