'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

type Section = { title: string; columns: string[]; rows: string[][] };
type Report = {
  issues: string[];
  sections: Section[];
  complete: boolean;
  cleanupCount: number;
  contractor: string;
  qboCustomerId: string;
};
type Project = {
  projectId: string;
  projectName: string;
  projectNumber: string;
  cycle: number;
  reviewedAt: string;
  run: null | {
    id: string;
    state: string;
    folder: string;
    report?: Report;
    revision: number;
    error: string;
    generatedAt: string;
    decidedBy: string;
    note: string;
  };
};
const endpoint = '/api/accounting/job-closeout';
const states: Record<string, string> = {
  queued: 'Queued',
  running: 'Reading sources',
  ready: 'Ready for review',
  partial: 'Needs AIA evidence',
  approved: 'Cleanup approved',
  closed: 'Signed off',
  retrying: 'Retry scheduled',
  failed: 'Source needs attention',
};
const btn =
  'rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-100 disabled:opacity-50';

async function projects(project = '', signal?: AbortSignal): Promise<Project[]> {
  const response = await fetch(endpoint + (project ? '?project=' + encodeURIComponent(project) : ''), {
    cache: 'no-store',
    signal,
  });
  const body = await response.json();
  if (!response.ok) throw Error(body.error || 'Closeout data unavailable.');
  return body.projects;
}
function Review({ job, reload }: { job: Project; reload: () => void }) {
  const run = job.run,
    report = run?.report;
  const [folder, setFolder] = useState(run?.folder || ''),
    [note, setNote] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  async function save(action: string) {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action,
          cycle: job.cycle,
          projectId: job.projectId,
          runId: run?.id ?? null,
          folder,
          note,
        }),
      });
      if (!response.ok) throw Error((await response.json()).error);
      setMessage(action === 'refresh' ? 'Refresh queued.' : 'Decision saved.');
      reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Unable to save.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="min-w-0 space-y-5">
      <header>
        <h2 className="text-2xl font-semibold">{job.projectName}</h2>
        <p className="text-sm text-slate-600">
          {job.projectNumber} · PM reviewed {new Date(job.reviewedAt).toLocaleDateString()} ·{' '}
          {states[run?.state] || 'Waiting for desktop'}
        </p>
        {run?.generatedAt && (
          <p className="text-sm">
            Report {run.revision} · {new Date(run.generatedAt).toLocaleString()} · {report?.contractor} · QBO
            project {report?.qboCustomerId}
          </p>
        )}
      </header>
      <div className="rounded-lg border p-4">
        <label className="block text-sm font-semibold" htmlFor="folder">
          Project folder under AIA Documents
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            id="folder"
            className="min-w-48 flex-1 rounded border p-2 text-sm"
            placeholder="Contractor / Completed / Project"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
          />
          <button className={btn} disabled={busy} onClick={() => save('refresh')}>
            Refresh from sources
          </button>
        </div>
        {run?.error && (
          <p role="alert" className="mt-2 text-red-800">
            {run.error}
          </p>
        )}
      </div>
      {message && <p role="status">{message}</p>}
      {report && (
        <>
          {report.sections.map((s, i) => (
            <details key={s.title} open={i < 2} className="rounded-lg border bg-white px-4 py-3 text-slate-900">
              <summary className="cursor-pointer font-semibold">{s.title}</summary>
              {s.rows.length ? (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left text-sm tabular-nums">
                    <thead>
                      <tr>
                        {s.columns.map((c) => (
                          <th className="border-b p-2 text-slate-600" key={c}>
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {s.rows.map((r, j) => (
                        <tr key={j} className="border-b border-slate-100">
                          {r.map((v, k) => (
                            <td className="p-2 align-top" key={k}>
                              {v}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-2 text-sm">None identified.</p>
              )}
            </details>
          ))}
          <section className="rounded-lg border p-4">
            <h3 className="font-semibold">Office review</h3>
            {report.issues.length ? (
              <ul className="my-3 list-disc space-y-1 pl-5 text-sm">
                {report.issues.map((v, i) => (
                  <li key={i}>{v}</li>
                ))}
              </ul>
            ) : (
              <p>All comparisons match.</p>
            )}
            {run.decidedBy && (
              <p>
                Recorded by {run.decidedBy}. {run.note}
              </p>
            )}
            {run.state === 'ready' && (
              <>
                <label className="block text-sm font-medium" htmlFor="decision">
                  Review note {report.issues.length > 0 && !report.cleanupCount ? '(required for exceptions)' : ''}
                </label>
                <textarea
                  id="decision"
                  value={note}
                  maxLength={2000}
                  onChange={(e) => setNote(e.target.value)}
                  className="my-2 block w-full rounded border p-2"
                />
                <button
                  className={btn}
                  disabled={busy || (!report.cleanupCount && report.issues.length > 0 && !note.trim())}
                  onClick={() => save(report.cleanupCount ? 'approve' : 'close')}
                >
                  {report.cleanupCount ? 'Approve proposed cleanup' : 'Sign off closeout'}
                </button>
              </>
            )}
            {run.state === 'approved' && (
              <p>Apply the approved rows in Procore and refresh to verify the changes.</p>
            )}
          </section>
        </>
      )}
    </article>
  );
}
export default function JobCloseoutPage() {
  const [queue, setQueue] = useState<Project[]>([]),
    [selected, setSelected] = useState(''),
    [job, setJob] = useState<Project>(null),
    [error, setError] = useState(''),
    [tick, setTick] = useState(0),
    [loaded, setLoaded] = useState(false);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    const timer = setInterval(reload, 60000);
    return () => clearInterval(timer);
  }, [reload]);
  useEffect(() => {
    const abort = new AbortController();
    projects('', abort.signal)
      .then((rows) => {
        setQueue(rows);
        setLoaded(true);
        setError('');
        setSelected(
          (prev) =>
            rows.find((r) => r.projectId === (prev || new URLSearchParams(window.location.search).get('project')))
              ?.projectId ||
            rows[0]?.projectId ||
            '',
        );
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [tick]);
  useEffect(() => {
    const abort = new AbortController();
    if (selected)
      projects(selected, abort.signal)
        .then((rows) => setJob(rows[0] ?? null))
        .catch((e) => {
          if (!abort.signal.aborted) setError(e.message);
        });
    return () => abort.abort();
  }, [selected, tick]);
  return (
    <main className="mx-auto max-w-7xl space-y-5 p-5 md:p-8">
      <header className="flex items-baseline justify-between">
        <h1 className="text-3xl font-bold">Job closeout</h1>
        <Link className="underline" href="/help/job-closeout">
          Help
        </Link>
      </header>
      {error && (
        <p role="alert">
          {error}{' '}
          <button className={btn} onClick={reload}>
            Reload
          </button>
        </p>
      )}
      <div className="grid items-start gap-6 md:grid-cols-[16rem_minmax(0,1fr)]">
        <aside>
          <h2 className="mb-2 font-semibold">PM-reviewed jobs</h2>
          {!queue.length && <p>{loaded ? 'No PM-reviewed jobs.' : 'Loading jobs…'}</p>}
          {queue.map((r) => (
            <button
              key={r.projectId}
              onClick={() => setSelected(r.projectId)}
              aria-pressed={selected === r.projectId}
              className={
                'mb-1 block w-full rounded p-2 text-left ' +
                (selected === r.projectId ? 'bg-slate-800 text-white' : 'border')
              }
            >
              <span className="block font-medium">{r.projectName}</span>
              <span className="text-xs">{states[r.run?.state] || 'Waiting for desktop'}</span>
            </button>
          ))}
        </aside>
        {selected && job?.projectId === selected ? (
          <Review key={[job.projectId, job.run?.id, job.run?.state].join('/')} job={job} reload={reload} />
        ) : (
          selected && <p>Loading review…</p>
        )}
      </div>
    </main>
  );
}
