import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, watch } from 'node:fs';
import { dirname, join, relative } from 'node:path';

export function pageRouteFromFile(file) {
  const parts = file.replaceAll('\\', '/').split('/');
  if (!/^page\.(tsx|ts|jsx|js)$/.test(parts.pop())) return null;
  const route = [];
  for (let segment of parts) {
    if (segment.startsWith('_')) return null;
    if (segment.startsWith('@') || /^\([^)]*\)$/.test(segment)) continue;
    if (segment.startsWith('(...)')) { route.length = 0; segment = segment.slice(5); }
    else {
      while (segment.startsWith('(..)')) { route.pop(); segment = segment.slice(4); }
      if (segment.startsWith('(.)')) segment = segment.slice(3);
    }
    if (segment) route.push(segment.replace(/%5F/gi, '_'));
  }
  return '/' + route.join('/');
}

export function discoverAppPages(appRoot) {
  const routes = new Map();
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('_') || entry.name === 'api' && directory === appRoot) continue;
      const file = join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) {
        const source = relative(appRoot, file).replaceAll('\\', '/');
        const pathname = pageRouteFromFile(source);
        if (pathname) routes.set(pathname, [...(routes.get(pathname) || []), source].sort());
      }
    }
  }
  visit(appRoot);
  return [...routes].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([pathname, sources]) => ({ pathname, sources }));
}

export function generateAppPageInventory(root) {
  const pages = discoverAppPages(join(root, 'src/app'));
  const target = join(root, 'src/lib/generated/appPages.js');
  const contents = '// Generated from src/app page files by scripts/generateAppPageInventory.mjs.\n'
    + '// Page discovery never assigns permissions to users.\n'
    + `export const APP_PAGES = ${JSON.stringify(pages, null, 2)};\n`;
  if (!existsSync(target) || readFileSync(target, 'utf8') !== contents) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
  return pages;
}

export function watchAppPageInventory(root) {
  let timer;
  const watcher = watch(join(root, 'src/app'), { recursive: true }, (event, filename) => {
    if (event !== 'rename' && !/(^|[\\/])page\.(tsx|ts|jsx|js)$/.test(String(filename))) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      try { generateAppPageInventory(root); }
      catch (error) { console.error('Unable to refresh page permission catalog:', error); }
    }, 100);
    timer.unref();
  });
  watcher.unref();
  return { close() { clearTimeout(timer); watcher.close(); } };
}
