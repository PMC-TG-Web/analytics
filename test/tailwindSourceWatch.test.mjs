import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

test('Tailwind watches application sources without watching generated repository output', async () => {
  const stylesheet = fileURLToPath(new URL('../src/app/globals.css', import.meta.url));
  const sourceRoot = path.resolve(path.dirname(stylesheet), '..');
  const result = await postcss([tailwind()]).process(readFileSync(stylesheet, 'utf8'), { from: stylesheet });
  const watched = result.messages.filter((message) => message.type === 'dir-dependency');
  assert.ok(watched.length > 0, 'application changes must still be watched');
  for (const dependency of watched) {
    const relative = path.relative(sourceRoot, dependency.dir);
    assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative), `unexpected watched directory: ${dependency.dir}`);
  }
  assert.ok(watched.some((dependency) => dependency.dir === path.join(sourceRoot, 'components')));
  assert.ok(watched.some((dependency) => dependency.dir === path.join(sourceRoot, 'app')));
  assert.ok(result.css.includes('.bg-teal-800'), 'application utility styles must still be generated');
  assert.ok(result.css.includes('.text-slate-900'), 'shared component utility styles must still be generated');
});
