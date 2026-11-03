import { fileURLToPath } from 'node:url';
import { generateAppPageInventory } from './lib/appPageInventory.mjs';

const pages = generateAppPageInventory(fileURLToPath(new URL('../', import.meta.url)));
console.log(`Page permission catalog: ${pages.length} app routes discovered.`);
