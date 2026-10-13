import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { getDeveloperEmail } from '../src/lib/developerIdentity.ts';

async function resolve({ environment = 'development', host = 'localhost:3000', developerEmail = 'todd@pmcdecor.com', sessionEmail = null } = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync('src/lib/subcontractAllocationSession.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const imports = {
    'next/headers': { headers: async () => ({ get: () => host }), cookies: async () => ({ get: () => developerEmail ? { value: developerEmail } : undefined }) },
    '@/lib/developerIdentity': { getDeveloperEmail: request => getDeveloperEmail(request, environment) },
    '@/lib/requestUser': { getCurrentUserEmail: async () => sessionEmail },
  };
  vm.runInNewContext(code, { exports: module.exports, module, URL, process: { env: { NODE_ENV: environment } }, require: id => { if (!(id in imports)) throw Error(id); return imports[id]; } });
  return module.exports.getAllocationUserEmail();
}

test('localhost developer sign-in reaches the same Todd identity as middleware', async () => {
  assert.equal(await resolve(), 'todd@pmcdecor.com');
  assert.equal(await resolve({ developerEmail: 'david@pmcdecor.com' }), 'david@pmcdecor.com');
});

test('production and nonlocal requests cannot use the developer cookie', async () => {
  assert.equal(await resolve({ environment: 'production' }), null);
  assert.equal(await resolve({ host: 'analyticspmc.netlify.app' }), null);
  assert.equal(await resolve({ host: 'localhost.attacker.com' }), null);
  assert.equal(await resolve({ host: null }), null);
});

test('authenticated sessions remain the fallback when no local identity is selected', async () => {
  assert.equal(await resolve({ developerEmail: null, sessionEmail: 'todd@pmcdecor.com' }), 'todd@pmcdecor.com');
  assert.equal(await resolve({ environment: 'production', sessionEmail: 'todd@pmcdecor.com' }), 'todd@pmcdecor.com');
});
