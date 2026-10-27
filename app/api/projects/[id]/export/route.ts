import { exportProject } from '../../../../../src/server/export.ts';
import { getProject } from '../../../../../src/server/projects.ts';
import { getSessionUser, userScope } from '../../../../../src/server/session.ts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) return new Response('Sign in first', { status: 401 });
  const project = await getProject(id, user.id);
  if (!project) return new Response('Not found', { status: 404 });

  const body = await exportProject(project, await userScope(user.id));
  const filename = `${project.name.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'project'}.zip`;
  return new Response(new Uint8Array(body), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
