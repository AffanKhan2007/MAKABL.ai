import { livePreviewOf } from '../../../../../src/build/preview.ts';
import { getProject } from '../../../../../src/server/projects.ts';
import { getSessionUser } from '../../../../../src/server/session.ts';

// Where the live view of a project's build is, for the page to embed. Only the project's
// owner can ask (row-level security), and it says nothing about other projects.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) return new Response('Sign in first', { status: 401 });
  if (!(await getProject(id, user.id))) return new Response('Not found', { status: 404 });
  const p = livePreviewOf(id);
  return Response.json({ status: p?.status ?? 'none', url: p?.status === 'running' ? p.url : null, log: p?.status === 'failed' ? p.log.slice(-600) : '' });
}
