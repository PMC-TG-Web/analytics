import type { Metadata } from 'next';
import { marketSeries, marketChanges, marketFreshness, marketSignal, formatMarketValue, type MarketSeries, type SavedMarketSeries } from '@/lib/marketSeries';
import { loadMarketOutlook } from '@/lib/loadMarketOutlook';
import styles from './market-outlook.module.css';

export const metadata: Metadata = { title: 'Market Outlook | Analytics' };
export const dynamic = 'force-dynamic';

const dateLabel = (date: string) => new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
function periodLabel(period: string, frequency: MarketSeries['frequency']) {
  const date = new Date(period + 'T12:00:00Z');
  if (frequency === 'quarterly') return 'Q' + (Math.floor(date.getUTCMonth() / 3) + 1) + ' ' + date.getUTCFullYear();
  return date.toLocaleDateString('en-US', { month: 'short', ...(frequency === 'monthly' ? {} : { day: 'numeric' as const }), year: 'numeric', timeZone: 'UTC' });
}
const signed = (value: number) => (value > 0 ? '+' : '') + value.toFixed(1);

export default async function MarketOutlookPage() {
  const { snapshots, error } = await loadMarketOutlook();
  const now = new Date();
  const byId = new Map(snapshots.map(snapshot => [snapshot.id, snapshot]));
  const current = marketSeries.filter(series => marketFreshness(series, byId.get(series.id), now) === 'Current');
  const successful = snapshots.map(snapshot => snapshot.lastSuccessAt).filter((value): value is string => Boolean(value)).sort().at(-1);
  const comparable = current.filter(series => marketChanges(byId.get(series.id)!.points, series.frequency).annualChange !== null);
  const costs = comparable.filter(series => series.kind === 'cost');
  const risingCosts = costs.filter(series => marketSignal(series, byId.get(series.id), now) === 'weak');
  const demand = comparable.filter(series => series.kind === 'demand');
  const growingDemand = demand.filter(series => marketSignal(series, byId.get(series.id), now) === 'strong');
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div><p className={styles.eyebrow}>PARADISE MASONRY · MARKET INTELLIGENCE</p><h1>Market Outlook</h1><p className={styles.intro}>Published market data for tracking demand, material costs, labor, and financing.</p></div>
        <div className={styles.asOf}><span>Latest successful refresh</span><strong>{successful ? dateLabel(successful) : 'Awaiting first sync'}</strong><small>Each source has its own reporting period</small></div>
      </section>
      {error && <p role="alert" className={styles.notice}>{error}</p>}
      <section className={styles.coverage} aria-label="Data coverage">
        <strong>{current.length} of {marketSeries.length} feeds current</strong>
        <span>Daily release checks when enabled · Publication schedules vary by source</span>
        <a href="/market-outlook">Reload saved data ↻</a>
      </section>
      <section className={styles.readout}>
        <div><p className={styles.kicker}>FROM THE CURRENT DATA</p><h2>{current.length ? 'Cost pressure and demand, measured separately.' : 'Waiting for current observations.'}</h2>
          <p>{costs.length ? risingCosts.length + ' of ' + costs.length + ' current cost indicators are more than 1% above a year earlier.' : 'Current cost comparisons are not yet available.'} {demand.length ? growingDemand.length + ' of ' + demand.length + ' current demand indicators are more than 1% above a year earlier.' : 'Current demand comparisons are not yet available.'}</p>
          <p>These counts describe the connected series; they are not a forecast or a weighted market index. Missing or overdue feeds are excluded.</p>
        </div>
        <div className={styles.actionBox}><span>LOCAL DECISIONS</span><strong>Use Pennsylvania evidence alongside national benchmarks.</strong><p>Local commercial permits, architecture activity, and contractor backlog still need separate coverage.</p></div>
      </section>
      <div className={styles.sectionHeading}><div><p className={styles.kicker}>PUBLIC DATA</p><h2>Latest published observations</h2></div></div>
      {(['Pipeline', 'Material costs', 'Labor', 'Current market', 'Financing'] as const).map(group => (
        <section className={styles.group} key={group}>
          <h3>{group}</h3>
          <div className={styles.grid}>{marketSeries.filter(series => series.group === group).map(series => <MarketCard key={series.id} series={series} saved={byId.get(series.id)} now={now} />)}</div>
        </section>
      ))}
      <p className={styles.method}>Signal rule: demand growth above 1% year over year is favorable; cost growth above 1% is pressure. Changes within ±1% are broadly flat. Financing and unemployment remain context indicators. Missing comparisons and overdue data receive no directional signal.</p>
      <section className={styles.regional}>
        <div><p className={styles.kicker}>COVERAGE STILL TO CONNECT</p><h2>Planning and local pipeline</h2></div>
        <div><p>AIA architecture billings, inquiries, design contracts and sector forecasts; ABC backlog and confidence; local commercial permits.</p><p>Census Building Permits Survey covers residential construction. It is not a measure of local commercial project starts. <a href="https://www.census.gov/construction/bps/" target="_blank" rel="noreferrer">Source coverage ↗</a></p></div>
      </section>
      <p className={styles.disclaimer}>Published observations may be revised. Market indicators support planning and do not guarantee future construction volume.</p>
    </main>
  );
}

function MarketCard({ series, saved, now }: { series: MarketSeries; saved?: SavedMarketSeries; now: Date }) {
  const points = saved?.points ?? [];
  const { latest, previousChange, annualChange, previous, annual } = marketChanges(points, series.frequency);
  const freshness = marketFreshness(series, saved, now);
  const signal = marketSignal(series, saved, now);
  const signalText = signal === 'watch' ? 'Context' : signal === 'mixed' ? 'Broadly flat' : series.kind === 'cost' ? (signal === 'weak' ? 'Cost pressure' : 'Cost easing') : signal === 'strong' ? 'Growing' : 'Softening';
  const comparison = series.format === 'percent'
    ? [previous ? signed(latest!.value - previous.value) + ' pp vs prior period' : null, annual ? signed(latest!.value - annual.value) + ' pp vs year earlier' : null]
    : [previousChange !== null ? signed(previousChange) + '% vs prior ' + (series.frequency === 'daily' ? 'day' : series.frequency === 'weekly' ? 'week' : series.frequency === 'quarterly' ? 'quarter' : 'month') : null, annualChange !== null ? signed(annualChange) + '% vs year earlier' : null];
  const history = points.slice(-12);
  const min = Math.min(...history.map(point => point.value));
  const range = Math.max(...history.map(point => point.value)) - min;
  const line = history.map((point, index) => (4 + index * 272 / Math.max(1, history.length - 1)) + ',' + (range ? 52 - (point.value - min) / range * 44 : 30)).join(' ');
  return <article className={styles.card}>
    <header><span className={styles.badge + ' ' + styles[signal]}>{latest ? signalText : 'Pending'}</span><span className={freshness === 'Current' ? styles.fresh : styles.overdue}>{freshness}</span></header>
    <h4>{series.name}</h4><div className={styles.value}>{latest ? formatMarketValue(series, latest.value) : '—'}</div>
    <div className={styles.change}>{latest ? comparison.filter(Boolean).join(' · ') || 'Comparison not available' : 'No saved observations yet'}</div>
    {history.length > 1 && <svg className={styles.sparkline} viewBox="0 0 280 60" role="img" aria-label={series.name + ': last ' + history.length + ' observations; exact values in history below'}><polyline points={line} fill="none" stroke="currentColor" strokeWidth="2.5" /></svg>}
    <p className={styles.note}>{series.note}{latest?.preliminary ? ' Latest value is preliminary.' : ''}</p>
    <dl className={styles.meta}><div><dt>Geography</dt><dd>{series.geography}</dd></div><div><dt>Units</dt><dd>{series.units}</dd></div><div><dt>Checked</dt><dd>{saved ? dateLabel(saved.checkedAt) : 'Not checked yet'}</dd></div>{latest?.publishedAt && <div><dt>Published</dt><dd>{dateLabel(latest.publishedAt)}</dd></div>}{saved?.status !== 'ok' && latest && <div><dt>Last success</dt><dd>{saved?.lastSuccessAt ? dateLabel(saved.lastSuccessAt) : 'Unknown'}</dd></div>}</dl>
    <footer><span>{latest ? periodLabel(latest.period, series.frequency) : 'Awaiting release data'}</span><a href={latest?.sourceUrl ?? series.sourceUrl} target="_blank" rel="noreferrer">{series.source} ↗</a></footer>
    {history.length > 0 && <details className={styles.history}><summary>Recent history</summary><table><caption>{series.units}</caption><thead><tr><th scope="col">Period</th><th scope="col">Value</th></tr></thead><tbody>{[...history].reverse().map(point => <tr key={point.period}><td>{periodLabel(point.period, series.frequency)}{point.preliminary ? ' *' : ''}</td><td>{point.sourceUrl ? <a href={point.sourceUrl} target="_blank" rel="noreferrer">{formatMarketValue(series, point.value)} ↗</a> : formatMarketValue(series, point.value)}</td></tr>)}</tbody></table><small>* Preliminary. Historical readings can be revised.</small></details>}
  </article>;
}
