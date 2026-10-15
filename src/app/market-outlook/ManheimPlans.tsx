'use client';

import { useState } from 'react';
import { manheimFreshness, manheimProjectUrl, manheimSource, type SavedManheim } from '@/lib/marketManheim';
import { marketProjectFocus } from '@/lib/marketProjectFocus';
import styles from './market-outlook.module.css';

const dateLabel = (value: string, timeZone = 'America/New_York') => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone });
const statusOrder = { Approved: 0, 'Under construction': 1, 'Under review': 2 };

export default function ManheimPlans({ saved, error, now }: { saved: SavedManheim | null; error: string | null; now: string }) {
  const [scope, setScope] = useState('focus');
  const [stage, setStage] = useState('advanced');
  const [search, setSearch] = useState('');
  const projects = saved?.data?.projects ?? [];
  const relevant = projects.filter(project => marketProjectFocus(project).included);
  const scoped = scope === 'focus' ? relevant : projects;
  const visible = scoped.filter(project => (stage === 'all' || stage === 'advanced' && project.status !== 'Under review' || project.status === stage) && (!search.trim() || [project.name, project.description, project.address].join(' ').toLowerCase().includes(search.trim().toLowerCase()))).sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || (b.postedAt ?? '').localeCompare(a.postedAt ?? '') || a.name.localeCompare(b.name));
  const freshness = manheimFreshness(saved, new Date(now));
  return <section className={styles.localPlans} aria-labelledby="manheim-heading">
    <div className={styles.sectionHeading}><div><p className={styles.kicker}>LANCASTER COUNTY · MANHEIM TOWNSHIP</p><h2 id="manheim-heading">Commercial & multifamily project tracker</h2></div><a href={manheimSource} target="_blank" rel="noreferrer">Township tracker ↗</a></div>
    <p className={styles.localIntro}>Projects listed as approved appear first. Includes warehouses, retail, offices, industrial, institutional and apartment buildings identified from published project details. Statuses are reported by Manheim Township; issued building permits are not yet connected.</p>
    <p className={styles.localIntro}><strong>These are existing tracker listings, not newly approved projects.</strong> The township supplies a posting date, but no approval or permit date. Many records share the same posting date. A successful feed check does not verify that an individual project’s status recently changed.</p>
    <div className={styles.localSummary}>
      {saved?.data ? <><strong>{relevant.filter(project => project.status === 'Approved').length} listed as approved</strong><span>{relevant.filter(project => project.status === 'Under construction').length} listed as under construction</span><span>{relevant.filter(project => project.status === 'Under review').length} listed as under review</span></> : <strong>Awaiting township data</strong>}
      <span className={freshness === 'Current' ? styles.fresh : styles.overdue}>{freshness === 'Current' ? 'Feed check current' : freshness}</span>
      {saved?.data && <span>Township layers updated {dateLabel(saved.data.sourceUpdatedAt)} or later</span>}{saved && <span>Checked {dateLabel(saved.checkedAt)}</span>}
    </div>
    {(error || saved?.status === 'error') && <p role="alert" className={styles.notice}>{error || saved?.message}{saved?.lastSuccessAt ? ' Last successful refresh: ' + dateLabel(saved.lastSuccessAt) + '.' : ''}</p>}
    {saved?.data && <>
      <div className={styles.localFilters}>
        <label>Project scope<select aria-label="Township project scope" value={scope} onChange={event => setScope(event.target.value)}><option value="focus">Commercial, industrial & multifamily</option><option value="all">All projects</option></select></label>
        <label>Reported stage<select aria-label="Reported stage" value={stage} onChange={event => setStage(event.target.value)}><option value="advanced">Approved & under construction</option><option value="Approved">Approved</option><option value="Under construction">Under construction</option><option value="Under review">Under review</option><option value="all">All stages</option></select></label>
        <label>Find a project<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Project, address, or description" /></label>
      </div>
      <p className={styles.localCount} aria-live="polite">Showing {visible.length} projects · {scoped.length} in selected scope · {projects.length} township records</p>
      <div className={styles.localTableWrap} tabIndex={0} role="region" aria-label="Manheim Township project list">
        <table className={styles.localTable}><caption>Township-reported stage and tracker posting date. Approval and permit dates are not provided by this feed.</caption>
          <thead><tr><th scope="col">Project / location</th><th scope="col">Reported stage</th><th scope="col">Suggested type</th><th scope="col">Plan details</th><th scope="col">Tracker posted</th></tr></thead>
          <tbody>{visible.map(project => <tr key={project.id}>
            <td><a href={manheimProjectUrl(project)} target="_blank" rel="noreferrer">{project.name} ↗</a><small>{project.address || 'Address not provided'} · Manheim Township</small><p>{project.description || 'Description not provided.'}</p></td>
            <td><strong>{project.status}</strong>{project.status === 'Approved' && <small>Approval date not provided</small>}</td><td>{marketProjectFocus(project).category}<small>Township use: {project.proposedUse || 'Not specified'}</small></td>
            <td>{project.planType || 'Not specified'}{project.drawingsUrl && <p><a href={project.drawingsUrl} target="_blank" rel="noreferrer">Plan drawings ↗</a></p>}</td><td>{project.postedAt ? dateLabel(project.postedAt, 'UTC') : 'Not provided'}</td>
          </tr>)}</tbody>
        </table>
        {!visible.length && <p className={styles.localIntro}>No saved township projects match these filters.</p>}
      </div>
    </>}
    <p className={styles.localFootnote}>Coverage is Manheim Township only. Suggested types are browsing aids based on published use and description; confirm building scope in the plans. Houses, lot changes and site-work-only entries are hidden by default. Approval does not establish permit issuance or a start date. These records may overlap county review submissions below; they are not added together as unique projects.</p>
  </section>;
}
