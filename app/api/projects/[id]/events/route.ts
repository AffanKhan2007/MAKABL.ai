import { PgEventLog } from '../../../../../src/db/pg-event-log.ts';
import type { ActivityEvent } from '../../../../../src/events/event-store.ts';
import { db } from '../../../../../src/server/db.ts';
import { getProject } from '../../../../../src/server/projects.ts';

// Server-sent events for one project's feed: the history, then new events as they are
// committed. The subscription starts before the history is read and events are
// de-duplicated by seq, so nothing falls in the gap between the two.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await getProject(id))) return new Response('Not found', { status: 404 });

  const log = new PgEventLog(db());
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let historySent = false;
      // A set rather than "highest seq seen": seq is assigned at insert, but concurrent
      // transactions can commit out of order, so a lower seq can arrive later.
      const sent = new Set<number>();
      const queued: ActivityEvent[] = [];
      const write = (text: string) => {
        if (!closed) controller.enqueue(encoder.encode(text));
      };
      const send = (e: ActivityEvent) => {
        if (sent.has(e.seq)) return;
        sent.add(e.seq);
        write(`id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`);
      };

      // NOTIFY reaches every listener; the projectId filter keeps other tenants out.
      const unsubscribe = await log.subscribe((e) => (historySent ? send(e) : queued.push(e)), { projectId: id });
      for (const e of await log.list(id)) send(e);
      historySent = true;
      for (const e of queued) send(e);
      write('event: history-done\ndata: {}\n\n');

      const ping = setInterval(() => write(': ping\n\n'), 15_000);
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(ping);
        void unsubscribe();
        try { controller.close(); } catch { /* already closed */ }
      };
      request.signal.addEventListener('abort', () => cleanup());
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
