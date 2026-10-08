import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

type StatusProject = {
  procoreProjectId: string;
  bidBoardStatus: string | null;
  status: string | null;
};

/** The local QBO report requires canonical statuses keyed by explicit Procore ID. */
export async function withQboProcoreStatusFile<T>(
  projects: StatusProject[],
  run: (environment: Record<string, string>) => Promise<T>,
): Promise<T> {
  const byProjectId = Object.fromEntries(projects.flatMap((project) => {
    const id = project.procoreProjectId.trim();
    const status = String(project.bidBoardStatus || project.status || '').trim();
    return id && status ? [[id, status]] : [];
  }));
  if (!Object.keys(byProjectId).length) {
    throw new Error('Project statuses are unavailable. The previous QBO snapshot has been retained.');
  }
  const directory = await mkdtemp(path.join(tmpdir(), 'qbo-profitability-'));
  const file = path.join(directory, 'procore-statuses.json');
  try {
    await writeFile(file, JSON.stringify({ byProjectId }), { mode: 0o600 });
    return await run({ PROJECT_PROFITABILITY_PROCORE_STATUS_FILE: file });
  } finally {
    await unlink(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
    await rmdir(directory);
  }
}
