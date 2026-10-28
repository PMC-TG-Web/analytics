'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { crewToday, crewWeekStart, type CrewScore, type CrewScorecard } from '@/lib/crewScorecard';
import styles from './crew-scorecard.module.css';

const number = (value: number, digits = 1) => value.toLocaleString('en-US', { maximumFractionDigits: digits });
const tons = (value: number) => value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
  timeZone: 'UTC', month: 'short', day: 'numeric',
});
const shiftWeek = (week: string, days: number) => new Date(new Date(`${week}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
const projectCount = (crews: CrewScore[]) => new Set(crews.flatMap(crew => crew.days.flatMap(day => day.projectId ? [day.projectId] : []))).size;

function pacePercent(value: number) {
  // Rounding must not make a below-target pace appear to meet the estimate.
  if (value !== 100 && Math.round(value) === 100) return value < 100 ? '<100%' : '>100%';
  return `${number(value, 0)}%`;
}

export default function CrewScorecardView({ initialWeek }: { initialWeek: string }) {
  const [week, setWeek] = useState(initialWeek);
  const [selectedCrew, setSelectedCrew] = useState('all');
  const [reviewOnly, setReviewOnly] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [report, setReport] = useState<CrewScorecard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const currentWeek = crewWeekStart(crewToday());

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setReport(null);
      setError(null);
      try {
        const response = await fetch(`/api/crew-scorecard?week=${encodeURIComponent(week)}`, {
          cache: 'no-store', credentials: 'include', signal: controller.signal,
        });
        const data: CrewScorecard & { error?: string } = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to load the scorecard.');
        if (!Array.isArray(data.crews) || data.week !== week) throw new Error('The scorecard response was incomplete. Please retry.');
        if (!controller.signal.aborted) setReport(data);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to load the scorecard.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [week, refresh]);

  const crews = (report?.crews || []).filter(crew => (selectedCrew === 'all' || crew.id === selectedCrew) && (!reviewOnly || crew.review.length > 0));
  const hours = crews.reduce((sum, crew) => sum + crew.hours, 0);
  const logHours = crews.reduce((sum, crew) => sum + crew.logHours, 0);
  const concrete = crews.reduce((sum, crew) => sum + crew.concrete, 0);
  const rebarTons = crews.reduce((sum, crew) => sum + crew.rebarTons, 0);
  const rebarUncalculatedEntries = crews.reduce((sum, crew) => sum + crew.rebarUncalculatedEntries, 0);
  const reviewCount = crews.reduce((sum, crew) => sum + crew.review.length, 0);
  const hasActivity = report?.crews.some(crew => crew.timecardCount || crew.logCount);

  function changeWeek(value: string) {
    try {
      setWeek(crewWeekStart(value));
      setSelectedCrew('all');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Choose a valid work date.');
    }
  }

  return <main className={styles.page}>
    <header className={styles.hero}>
      <div>
        <p className={styles.eyebrow}>OPERATIONS / WEEKLY FIELD REVIEW</p>
        <h1>Crew Scorecard</h1>
        <p className={styles.intro}>See the work. Find the gaps. Compare like work.</p>
        <p className={styles.attribution}>Grouped by the recorded submitter, not a verified historical crew roster.</p>
      </div>
      <div className={styles.preview}><strong>LOCAL PREVIEW</strong><span>Read-only saved data</span><span>No Procore or accounting writes</span></div>
    </header>

    <section className={styles.toolbar} aria-label="Scorecard filters">
      <div className={styles.weekControls}>
        <button type="button" onClick={() => changeWeek(shiftWeek(week, -7))} aria-label="Previous week">Previous</button>
        <label>Week of<input aria-label="Choose week" type="date" value={week} max={crewToday()} onChange={event => { if (event.target.value) changeWeek(event.target.value); }} /></label>
        <button type="button" disabled={week >= currentWeek} onClick={() => changeWeek(shiftWeek(week, 7))} aria-label="Next week">Next</button>
        <button type="button" onClick={() => changeWeek(currentWeek)}>This week</button>
      </div>
      <div className={styles.viewControls}>
        <label>Submitter<select aria-label="Filter submitter" value={selectedCrew} onChange={event => setSelectedCrew(event.target.value)}>
          <option value="all">All foremen and other submitters</option>
          {report?.crews.map(crew => <option value={crew.id} key={crew.id}>{crew.name}{crew.isForeman ? '' : ' (other submitter)'}</option>)}
        </select></label>
        <label className={styles.checkbox}><input type="checkbox" checked={reviewOnly} onChange={event => setReviewOnly(event.target.checked)} />Needs review only</label>
        <button type="button" disabled={loading} onClick={() => setRefresh(value => value + 1)}>Refresh saved data</button>
      </div>
    </section>

    {loading && <section className={styles.state} role="status"><span className={styles.loadingDot} />Loading this week&apos;s saved field records and estimate comparisons...</section>}
    {error && <section className={styles.error} role="alert"><strong>Scorecard unavailable</strong><p>{error}</p><button type="button" onClick={() => setRefresh(value => value + 1)}>Retry</button></section>}

    {report && !loading && !error && <>
      <section className={styles.period}>
        <div><h2>{dateLabel(report.week)} - {dateLabel(report.through)}, {report.week.slice(0, 4)}</h2><span>{report.through >= report.today ? 'Week in progress' : 'Completed calendar week'} / Monday - Sunday / selected submitters</span></div>
        <div className={styles.freshness}>
          <span>Read {new Date(report.loadedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
          <small>Latest work dates in this week: timecards {report.newestTimecardDate ? dateLabel(report.newestTimecardDate) : 'none'} / logs {report.newestLogDate ? dateLabel(report.newestLogDate) : 'none'}</small>
        </div>
      </section>
      <section className={styles.metrics} aria-label="Selected submitter totals">
        <Metric label="Field labor hours" value={number(hours)} detail={`${number(hours - logHours)} h timecards / ${number(logHours)} h daily-log labor items`} />
        <Metric label="Projects with records" value={number(projectCount(crews), 0)} detail="Distinct linked Procore projects" />
        <Metric label="Concrete quantity used" value={`${number(concrete)} CY`} detail="Logged usage, not verified installed work" />
        <Metric label="Rebar installed (calc.)" value={rebarUncalculatedEntries > 0 && rebarTons === 0 ? 'Incomplete' : `${tons(rebarTons)} tons`}
          detail={`From quantity used and bar specs; not scale-verified${rebarUncalculatedEntries ? ` / ${number(rebarUncalculatedEntries, 0)} entries need details` : ''}`} />
        <Metric label="Items to review" value={number(reviewCount, 0)} detail="Reporting gaps and source-data questions" attention={reviewCount > 0} />
      </section>
      <aside className={styles.notice}>
        <strong>{report.foremanCount} active foremen in employee records.</strong>{' '}
        Other submitters stay separate; no sixth crew or historical assignments are inferred. Missing records are review questions, not a score against a foreman.
        <Link href="/crew-management">Review crew setup</Link>
      </aside>
      {!hasActivity && <section className={styles.state}><strong>No saved field activity for this week.</strong><p>Try the previous week or check source synchronization. This does not prove the crews were idle.</p></section>}
      {hasActivity && crews.length === 0 && <section className={styles.state}>No submitters match these filters. Clear the submitter or review filter.</section>}

      {([true, false] as const).map(isForeman => {
        const group = crews.filter(crew => crew.isForeman === isForeman);
        if (!group.length) return null;
        return <section className={styles.crewSection} key={String(isForeman)}>
          <div className={styles.sectionHeading}><h2>{isForeman ? 'Foremen' : 'Other submitters'}</h2><span>{isForeman ? 'Open a row to inspect the week' : 'Kept separate until crew attribution is confirmed'}</span></div>
          <div className={styles.crewList}>{group.map(crew => <CrewRow crew={crew} today={report.today} key={`${report.week}:${crew.id}`} />)}</div>
        </section>;
      })}
      <details className={styles.method}>
        <summary>How to read this scorecard</summary>
        <ul>
          <li><strong>Hours:</strong> employee timecards plus daily-log quantities on PO items measured in hours, including confirmed labor items recorded in LS. Travel and other work are included. Generic subcontractor entries are excluded. Other labor units remain flagged for review. A project/day with hours from both sources is flagged so duplicate entry can be checked.</li>
          <li><strong>Attribution:</strong> both hours and quantities follow the person who submitted them. A different person entering logs can split one real crew across rows. Today&apos;s employee records do not establish past crew membership.</li>
          <li><strong>Quantities:</strong> quantity used, not quantity delivered. Individual PO lines and units stay separate. Rebar tons are calculated only for piece entries with a recognized bar size and explicit length, using the same weight-per-foot standards as Estimating Tools. Chairs, dowels and wire mesh are excluded; entries missing details are not guessed. This is calculated weight, not scale-verified tonnage. Fiber is not counted as concrete yards; hourly and billing-only entries do not become installed quantities.</li>
          <li><strong>Rate versus estimate:</strong> CY per field labor hour (timecards plus daily-log labor hours) for the same project and work type. Green means on or ahead of estimate (100% or more); red means behind estimate (below 100%). Unavailable comparisons stay neutral. The reference is the currently selected estimate&apos;s concrete quantity divided by its corresponding labor-group hours, without change orders. Past days with hours but no logs (prep, forming, stripping) stay in the hours and are listed for review. Rates are withheld when the project has source-data questions, logs without matching hours, possible duplicate hours, or an unfinished day. Prep, reinforcing, pours and finishing can fall in different weeks; this is a weekly indicator, not final productivity, percent complete or profit.</li>
          <li><strong>Reporting gaps:</strong> a past project/day with hours but no logs, or quantity logs with no timecard or daily-log labor hours from the same submitter. Today and future dates do not trigger these flags. Days with neither record cannot be checked without a reliable daily schedule. A field log may record labor rather than physical production.</li>
          <li><strong>Freshness:</strong> refresh reads PostgreSQL mirrors only. The read time is not a successful Procore sync time. Missing, ambiguous or invalid inputs stay visible rather than becoming favorable scores.</li>
        </ul>
        <p>Excluded this week: {report.excluded.subcontractorTimecards} subcontractor timecards, {report.excluded.billingLogs} billing-only logs, {report.excluded.subcontractorLogs} subcontractor logs and {report.excluded.deleted} deleted/voided records.</p>
      </details>
      <footer className={styles.footer}><span>Local preview / No rankings or financial conclusions from incomplete field data.</span><Link href="/analytics">Open Field Productivity</Link></footer>
    </>}
  </main>;
}

function Metric({ label, value, detail, attention = false }: { label: string; value: string; detail: string; attention?: boolean }) {
  return <article className={`${styles.metric} ${attention ? styles.attentionMetric : ''}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function CrewRow({ crew, today }: { crew: CrewScore; today: string }) {
  const activeDays = new Set(crew.days.filter(day => day.timecardCount || day.logCount).map(day => day.date)).size;
  return <details className={styles.crew}>
    <summary className={styles.crewSummary}>
      <div className={styles.crewIdentity}><span className={styles.avatar} aria-hidden="true">{crew.name.split(' ').slice(0, 2).map(name => name[0]).join('')}</span>
        <div><h3>{crew.name}</h3><small>{crew.isForeman ? 'Listed foreman' : 'Other / unconfirmed crew'} / {crew.workers} workers in timecards</small></div>
      </div>
      <div className={styles.miniMetric}><strong>{crew.timecardCount || crew.logHours ? number(crew.hours) : '--'}</strong><span>field hours</span></div>
      <div className={styles.miniMetric}><strong>{projectCount([crew])}<small> / {activeDays}</small></strong><span>jobs / days with records</span></div>
      <div className={styles.miniMetric}><strong>{crew.logCount ? number(crew.concrete) : '--'}</strong><span>concrete CY used</span></div>
      <div className={styles.crewAction}><span className={crew.review.length ? styles.reviewBadge : styles.neutralBadge}>{crew.review.length ? `${crew.review.length} to review` : crew.timecardCount || crew.logCount ? 'No record-backed gaps' : 'No records'}</span><span className={styles.openHint}>View week</span></div>
    </summary>
    <div className={styles.crewBody}>
      <div className={styles.breakdown}><span><strong>{number(crew.hours - crew.travelHours - crew.otherHours)} h</strong> classified production labor</span><span><strong>{number(crew.travelHours)} h</strong> travel</span><span><strong>{number(crew.otherHours)} h</strong> other / unclassified</span><span><strong>{number(crew.timecardHours)} h</strong> timecards / <strong>{number(crew.logHours)} h</strong> daily-log labor</span><span><strong>{tons(crew.rebarTons)} tons</strong> calculated rebar{crew.rebarUncalculatedEntries ? ` / ${crew.rebarUncalculatedEntries} entries need details` : ''}</span><span>{crew.timecardCount} timecards / {crew.logCount} field log lines</span></div>
      {crew.review.length > 0 && <section className={styles.reviewSection} aria-label={`Review items for ${crew.name}`}>
        <h4>Start here: verify these records</h4>
        <ul>{crew.review.map((item, index) => <li key={index}><span className={styles.reviewDate}>{dateLabel(item.date)}</span><div><strong>{item.projectName}</strong><p>{item.message}</p></div></li>)}</ul>
      </section>}
      <section>
        <h4>Concrete pace versus the estimate</h4>
        <p className={styles.sectionNote}>Same project and work type only. 100% matches estimate pace; higher is better. Weekly work mix affects these rates; do not use them as a foreman ranking.</p>
        {crew.rates.length ? <div className={styles.tableScroll}><table>
          <thead><tr><th>Project / work type</th><th>Labor hours</th><th>Concrete CY</th><th>Actual CY/hr</th><th>Estimate CY/hr</th><th>Comparison</th></tr></thead>
          <tbody>{crew.rates.map((rate, index) => <tr key={index}>
            <td><strong>{rate.projectName}</strong><small>{rate.workType}</small></td>
            <td>{number(rate.hours)}</td><td>{number(rate.concrete)}</td>
            <td>{rate.actualRate === null ? '--' : number(rate.actualRate, 2)}</td>
            <td>{rate.estimatedRate === null ? '--' : number(rate.estimatedRate, 2)}{rate.estimateName && <small>{rate.estimateName}</small>}</td>
            <td>{rate.percentOfEstimate === null ? <span className={styles.unavailable}>{rate.reason}</span> :
              <div className={`${styles.paceComparison} ${rate.percentOfEstimate >= 100 ? styles.paceGood : styles.paceBad}`}>
                <strong>{rate.percentOfEstimate > 100 ? 'Ahead of estimate' : rate.percentOfEstimate < 100 ? 'Behind estimate' : 'On estimate'}</strong>
                <small>{pacePercent(rate.percentOfEstimate)} of estimate pace</small>
              </div>}
            </td>
          </tr>)}</tbody>
        </table></div> : <p className={styles.emptyDetail}>No comparable concrete or classified production labor recorded.</p>}
      </section>
      <section>
        <h4>Daily job coverage</h4>
        {crew.days.length ? <div className={styles.tableScroll}><table>
          <thead><tr><th>Work date</th><th>Project</th><th>Hours</th><th>Hour sources</th><th>Timecard entries</th><th>Field log lines</th><th>Record coverage</th></tr></thead>
          <tbody>{crew.days.map((day, index) => <tr key={index}>
            <td>{dateLabel(day.date)}</td><td>{day.projectName}</td><td>{number(day.hours)}</td><td>{day.timecardHours > 0 && day.logHours > 0 ? 'Timecards + daily log - check duplicates' : day.logHours > 0 ? 'Daily-log labor' : day.timecardHours > 0 ? 'Timecards' : '--'}</td><td>{day.timecardCount}</td><td>{day.logCount}</td>
            <td>{day.date >= today ? 'Open day - no gap flag' : day.hours > 0 && day.logCount ? 'Hours + logs' : day.hours > 0 ? 'Hours only' : day.logCount ? 'Logs without hours' : 'Source review'}</td>
          </tr>)}</tbody>
        </table></div> : <p className={styles.emptyDetail}>No saved records this week. A missing schedule prevents an attendance conclusion.</p>}
      </section>
      <details className={styles.quantityDetails}>
        <summary>Quantity detail / {crew.quantities.length} distinct project and PO lines</summary>
        <p className={styles.sectionNote}>Different items and units are not combined. These are usage entries, not an inspection of installed work.</p>
        {crew.quantities.length ? <div className={styles.tableScroll}><table>
          <thead><tr><th>Project</th><th>PO line / cost code</th><th>Quantity used</th><th>Unit</th><th>Calculated rebar tons</th><th>Log lines</th></tr></thead>
          <tbody>{crew.quantities.map((quantity, index) => <tr key={index}>
            <td>{quantity.projectName}</td>
            <td><strong>{quantity.description}</strong><small>{quantity.logDescription && quantity.logDescription !== quantity.description ? `Log: ${quantity.logDescription} / ` : ''}{quantity.costCode || 'Unassigned code'} / Line {quantity.lineItemId || 'unresolved'}</small></td>
            <td>{number(quantity.quantity, 2)}</td><td>{quantity.unit}</td>
            <td>{quantity.rebarTons !== null ? number(quantity.rebarTons, 3) : quantity.rebarUncalculatedCount ? 'Needs size/length' : '--'}
              {quantity.rebarUncalculatedCount > 0 && quantity.rebarTons !== null && <small>{quantity.rebarUncalculatedCount} more entries need details</small>}</td>
            <td>{quantity.logCount}</td>
          </tr>)}</tbody>
        </table></div> : <p className={styles.emptyDetail}>No non-hour quantities recorded.</p>}
      </details>
    </div>
  </details>;
}
