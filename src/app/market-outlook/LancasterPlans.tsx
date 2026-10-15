'use client';

import { useState } from 'react';
import { lancasterFreshness, lancasterProjectUrl, lancasterSource, type SavedLancaster } from '@/lib/marketLancaster';
import { marketProjectFocus } from '@/lib/marketProjectFocus';
import styles from './market-outlook.module.css';

const dateLabel = (value: string) => new Date(value.length === 10 ? value + 'T12:00:00Z' : value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });

export default function LancasterPlans({ saved, error, now }: { saved: SavedLancaster | null; error: string | null; now: string }) {
  const [municipality, setMunicipality] = useState('');
  const [use, setUse] = useState('');
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState('focus');
  const projects = saved?.data?.projects ?? [];
  const relevant = projects.filter(project => marketProjectFocus(project).included);
  const scoped = scope === 'focus' ? relevant : projects;
  const municipalities = [...new Set(projects.flatMap(project => project.municipality.split(', ')))].sort();
  const dates = [...new Set(projects.map(project => project.meetingDate))].sort();
  const freshness = lancasterFreshness(saved, new Date(now));
  const visible = scoped.filter(project => (!municipality || project.municipality.split(', ').includes(municipality)) && (!use || project.proposedUse.split(' / ').includes(use)) && (!search.trim() || [project.name, project.description, project.fileNumber, project.municipality].join(' ').toLowerCase().includes(search.trim().toLowerCase())));
  const uses = [...new Set(projects.flatMap(project => project.proposedUse.split(' / ').filter(Boolean)))].sort();
  return <section className={styles.localPlans} aria-labelledby="lancaster-heading">
    <div className={styles.sectionHeading}><div><p className={styles.kicker}>LANCASTER COUNTY</p><h2 id="lancaster-heading">Local development plans</h2></div><a href={lancasterSource} target="_blank" rel="noreferrer">County planning source ↗</a></div>
    <p className={styles.localIntro}>Subdivision and land-development submissions listed for county advisory review. These are early project leads; listing here does not establish municipal approval, a building permit, a bid opportunity, or a construction start.</p>
    <div className={styles.localSummary}>
      <strong>{saved?.data ? relevant.length + ' potential building projects' : 'Awaiting county data'}</strong>
      {saved?.data && <span>{projects.length} total county submissions</span>}
      {dates.length > 0 && <span>Review meeting{dates.length > 1 ? 's' : ''}: {dates.map(dateLabel).join(' · ')}</span>}
      <span className={freshness === 'Current' ? styles.fresh : styles.overdue}>{freshness}</span>
      {saved?.data && <span>County updated {dateLabel(saved.data.sourceUpdatedAt)}</span>}
      {saved && <span>Checked {dateLabel(saved.checkedAt)}</span>}
    </div>
    {(error || saved?.status === 'error') && <p role="alert" className={styles.notice}>{error || saved?.message}{saved?.lastSuccessAt ? ' Last successful refresh: ' + dateLabel(saved.lastSuccessAt) + '.' : ''}</p>}
    {projects.length > 0 && <>
      <div className={styles.localFilters}>
        <label>Project scope<select aria-label="County project scope" value={scope} onChange={event => setScope(event.target.value)}><option value="focus">Commercial, industrial & multifamily</option><option value="all">All submissions</option></select></label>
        <label>Municipality<select aria-label="Municipality" value={municipality} onChange={event => setMunicipality(event.target.value)}><option value="">All municipalities</option>{municipalities.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Proposed use<select aria-label="Proposed use" value={use} onChange={event => setUse(event.target.value)}><option value="">All uses</option>{uses.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Find a plan<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Project, description, or file number" /></label>
      </div>
      <p className={styles.localCount} aria-live="polite">Showing {visible.length} of {scoped.length} {scope === 'focus' ? 'potential building projects' : 'listed submissions'}</p>
      <div className={styles.localTableWrap} tabIndex={0} role="region" aria-label="Lancaster County development plan list">
        <table className={styles.localTable}><caption>Latest county review list. Proposed uses and plan types are reported by the county.</caption>
          <thead><tr><th scope="col">Project / county file</th><th scope="col">Municipality</th><th scope="col">Proposed use</th><th scope="col">Plan details</th><th scope="col">Review meeting</th></tr></thead>
          <tbody>{visible.map(project => <tr key={project.id}>
            <td><a href={lancasterProjectUrl(project.id)} target="_blank" rel="noreferrer">{project.name} ↗</a><small>{project.fileNumber || 'File number not provided'}</small><p>{project.description || 'Description not provided.'}</p></td>
            <td>{project.municipality}</td><td>{project.proposedUse || 'Not specified'}<small>Suggested: {marketProjectFocus(project).category}</small></td>
            <td>{project.planType || 'Not specified'}<small>{project.applicationType}</small></td><td>{dateLabel(project.meetingDate)}</td>
          </tr>)}</tbody>
        </table>
        {!visible.length && <p className={styles.localIntro}>No listed plans match these filters.</p>}
      </div>
    </>}
    {saved?.data && !projects.length && <p className={styles.localIntro}>The county feed currently lists no submissions. This does not mean there is no development activity in Lancaster County.</p>}
    <p className={styles.localFootnote}>The default scope uses published descriptions and uses to highlight commercial, industrial, institutional and multifamily buildings. Suggested types need confirmation in the plans; use All submissions to review excluded or unclear entries. The county feed is a rolling meeting list, not all active projects or issued permits. “Final Plan” describes the submission type, not an approval. <a href="https://lancastercountyplanning.org/157/Planning-Commission" target="_blank" rel="noreferrer">Agendas and minutes ↗</a></p>
  </section>;
}
