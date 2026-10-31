import { join } from 'node:path';

/** Where a project's generated code lives on this machine. */
export const workspaceDir = (projectId: string): string => join(process.cwd(), '.workspaces', projectId);
