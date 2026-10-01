// Repackage an existing Next.js build without running database migrations.
// Netlify CLI's expired-cache fallback can classify the generated Next handler
// as a user function, giving its /* route the same priority as our workers.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const cliRoot = process.env.NETLIFY_CLI_ROOT || (process.env.APPDATA
  ? join(process.env.APPDATA, 'npm', 'node_modules', 'netlify-cli')
  : '/usr/local/lib/node_modules/netlify-cli');
const require = createRequire(join(cliRoot, 'package.json'));
const { zipFunctions } = await import(pathToFileURL(require.resolve('@netlify/zip-it-and-ship-it')).href);
const generated = resolve(root, '.netlify/functions-internal');
if (!existsSync(join(generated, '___netlify-server-handler/___netlify-server-handler.mjs'))) {
  throw new Error('Build and package Next.js before deploying prebuilt functions.');
}
if (!existsSync(join(generated, '___netlify-server-handler/node_modules/.prisma/client/libquery_engine-rhel-openssl-3.0.x.so.node'))) {
  throw new Error('The Next.js package is missing the Netlify Linux Prisma engine. Run prisma generate and rebuild before deploying.');
}
const functions = await zipFunctions({
  generated: { directories: [generated] },
  user: { directories: [resolve(root, 'netlify/functions')] },
}, resolve(root, '.netlify/functions'), {
  basePath: root,
  configFileDirectories: [generated],
  config: { '*': { nodeVersion: '22', includedFiles: ['config/costCodeCatalog.json', 'config/qboCostCatalog.json'], includedFilesBasePath: root } },
  manifest: resolve(root, '.netlify/functions/manifest.json'),
});
const server = functions.find(f => f.name === '___netlify-server-handler');
const worker = functions.find(f => f.name === 'qbo-bill-batch-background');
if (!server || !worker || server.priority >= worker.priority) throw new Error('Generated Next.js routing must have lower priority than user workers.');
console.log(JSON.stringify({ functions: functions.length, serverPriority: server.priority, workerPriority: worker.priority }));
console.log('Deploy these packages immediately with netlify deploy --no-build --dir .netlify/static (add --prod for production). The CLI cache expires after two minutes.');
