import 'dotenv/config';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseArgs } from 'node:util';

// The application uses extensionless TypeScript imports; resolve them for Node's native TS loader.
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
    const candidate = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(fileURLToPath(candidate))) return next(candidate.href, context);
  }
  return next(specifier, context);
} });
const { values } = parseArgs({ options: { company: { type: 'string' }, project: { type: 'string' }, month: { type: 'string' }, out: { type: 'string' } } });
if (!values.company || !values.project || !values.month || !values.out) throw new Error('Required: --company ID --project ID --month YYYY-MM --out FILE');
const { loadQboDirectCosts } = await import('../src/lib/loadQboDirectCosts.ts');
const { prisma } = await import('../src/lib/prisma.ts');
try {
  const draft = await loadQboDirectCosts(values.company, values.project, values.month);
  await mkdir(path.dirname(path.resolve(values.out)), { recursive: true });
  // Never overwrite an earlier reviewed export implicitly.
  await writeFile(values.out, JSON.stringify(draft, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ output: path.resolve(values.out), project: draft.projectName, month: draft.month, total: draft.total, lines: draft.lines.length, issues: draft.issues, timecardsNotIncluded: draft.timecardsNotIncluded }));
} finally { await prisma.$disconnect(); }
