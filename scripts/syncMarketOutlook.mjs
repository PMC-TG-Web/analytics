// Read-only public fetch by default. --apply stores only Market Outlook data.
import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'], quiet: true });
const args = process.argv.slice(2);
if (args.some(arg => !['--apply', '--allow-remote', '--force'].includes(arg))) throw new Error('Usage: node scripts/syncMarketOutlook.mjs [--apply] [--allow-remote] [--force]');
if (args.includes('--apply')) {
  const target = new URL(process.env.MARKET_DATABASE_URL || process.env.DATABASE_URL);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) && !args.includes('--allow-remote')) throw new Error('Remote database requires explicit --allow-remote. Use MARKET_DATABASE_URL for an isolated local preview.');
  const { syncMarketOutlook } = await import('../src/lib/syncMarketOutlook.ts');
  const { marketDatabase } = await import('../src/lib/marketStore.ts');
  try { console.log(JSON.stringify(await syncMarketOutlook({ force: args.includes('--force') }), null, 2)); }
  finally { await (await marketDatabase()).$disconnect(); }
} else {
  const { fetchMarketFeeds } = await import('../src/lib/marketFeeds.ts');
  const results = await fetchMarketFeeds();
  console.log(JSON.stringify(results.map(({ id, status, message, points }) => ({ id, status, message, observations: points.length, latest: points.at(-1) ?? null })), null, 2));
}
