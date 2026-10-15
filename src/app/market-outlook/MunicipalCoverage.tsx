import { municipalSources, municipalFreshness, type SavedMunicipal } from '@/lib/marketMunicipal';
import styles from './market-outlook.module.css';

const dateLabel = (value: string) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export default function MunicipalCoverage({ saved = [], error, now }: { saved?: SavedMunicipal[]; error?: string | null; now: string }) {
  const byId = new Map(saved.map(row => [row.id, row]));
  return <section className={styles.localPlans} aria-labelledby="municipal-heading">
    <div className={styles.sectionHeading}><div><p className={styles.kicker}>LANCASTER CITY & NEARBY TOWNSHIPS</p><h2 id="municipal-heading">Municipal plans & meeting records</h2></div></div>
    <p className={styles.localIntro}>Broader coverage for commercial, industrial, retail and apartment leads. Open plan drawings and planning records to confirm building scope and decisions. Meeting documents cover all land-use business; an agenda item is not an approval or issued permit.</p>
    {error && <p role="alert" className={styles.notice}>{error}</p>}
    <div className={styles.municipalGrid}>{municipalSources.map(source => {
      const row = byId.get(source.id), data = row?.data;
      const freshness = municipalFreshness(source, row, new Date(now));
      return <div className={styles.municipalCard} key={source.id} data-municipality={source.id}>
        <h3>{source.name}</h3>
        <p className={freshness === 'Recent meeting records' ? styles.fresh : styles.overdue}>{freshness}</p>
        {source.kind === 'city' ? <>
          <p>Current city approvals and permits still need a reliable source. Older map records are excluded from project leads.</p>
          {data?.latestRecordAt && <p><strong>Latest dated map record:</strong> {dateLabel(data.latestRecordAt)}</p>}
        </> : source.kind === 'plans' ? <>
          <p>Township lists these plans under review. Posting and approval dates are not supplied; drawings may have newer revisions.</p>
          <ul>{data?.plans.map(plan => <li key={plan.url}><a href={plan.url} target="_blank" rel="noreferrer">{plan.name} ↗</a></li>)}</ul>
        </> : <>
          <p>Latest available Planning Commission documents. Project decisions require reading the records.</p>
          <ul>{data?.documents.map(doc => <li key={doc.kind}>
            <a href={doc.url} target="_blank" rel="noreferrer">{doc.kind} · {dateLabel(doc.meetingDate)} ↗</a>
            {doc.cancelled && <small>Meeting cancelled</small>}
            {Date.parse(doc.meetingDate) > Date.parse(now) && <small>Upcoming meeting</small>}
            {Date.parse(now) - Date.parse(doc.meetingDate) > 90 * 86_400_000 && <small>Meeting more than 90 days ago</small>}
          </li>)}</ul>
          {data && !data.documents.some(doc => doc.kind === 'Minutes') && <p>No minutes linked in the checked listing.</p>}
        </>}
        {row?.status === 'error' && <p role="alert">{row.message}</p>}
        <div className={styles.municipalFooter}><a href={source.url} target="_blank" rel="noreferrer">{source.kind === 'plans' ? 'Township plan list' : 'Planning records'} ↗</a><small>{row ? 'Checked ' + dateLabel(row.checkedAt) : 'Not checked yet'}</small></div>
      </div>;
    })}</div>
    <p className={styles.localFootnote}>Daily checks update saved document links and source availability. They do not verify a project’s latest status. Manheim’s reported stages and the countywide submission list remain below; records can overlap across sources.</p>
  </section>;
}
