"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type CloseoutDisposition = "ready" | "review" | "complete" | "seeded";
type CloseoutType = "forms_closeout" | "project_management_closeout";

type CloseoutLine = {
  companyId: string;
  projectId: string;
  projectNumber: string | null;
  projectName: string;
  poNumber: string | null;
  poTitle: string | null;
  lineItemId: string;
  position: number | null;
  description: string | null;
  costCode: string | null;
  uom: string | null;
  expectedQuantity: number;
  usedQuantity: number;
  proposedQuantity: number;
  disposition: CloseoutDisposition;
  reason: string;
};

type PreviewResponse = {
  success?: boolean;
  error?: string;
  details?: string;
  lines?: CloseoutLine[];
};

type RunResponse = {
  success?: boolean;
  error?: string;
  details?: string;
  createdCount?: number;
  skippedCount?: number;
  failedCount?: number;
};

type Props = {
  open: boolean;
  companyId?: string;
  initialProjectId?: string;
  onClose: () => void;
  onCompleted: () => void | Promise<void>;
};

function formatQuantity(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value || 0);
}

function dispositionStyle(disposition: CloseoutDisposition) {
  if (disposition === "ready") return "bg-teal-100 text-teal-800";
  if (disposition === "review") return "bg-amber-100 text-amber-800";
  if (disposition === "seeded") return "bg-sky-100 text-sky-800";
  return "bg-slate-100 text-slate-700";
}

export default function FormsCloseoutPanel({ open, companyId, initialProjectId, onClose, onCompleted }: Props) {
  const [lines, setLines] = useState<CloseoutLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [projectId, setProjectId] = useState(initialProjectId || "");
  const [accountingDate, setAccountingDate] = useState("");
  const [closeoutType, setCloseoutType] = useState<CloseoutType>("forms_closeout");
  const closeoutLabel = closeoutType === "project_management_closeout" ? "Project Management" : "Forms";

  const loadPreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = new URL("/api/procore/productivity-logs/forms-closeout", window.location.origin);
      if (companyId) url.searchParams.set("companyId", companyId);
      url.searchParams.set("closeoutType", closeoutType);
      const response = await fetch(url.toString(), { credentials: "include", cache: "no-store" });
      const data = (await response.json()) as PreviewResponse;
      if (!response.ok || !data.success) throw new Error(data.details || data.error || `Preview failed (${response.status})`);
      setLines(Array.isArray(data.lines) ? data.lines : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [closeoutType, companyId]);

  useEffect(() => {
    if (!open) return;
    setProjectId(initialProjectId || "");
    setMessage(null);
  }, [initialProjectId, open]);

  useEffect(() => {
    if (!open) return;
    void loadPreview();
  }, [loadPreview, open]);

  const projects = useMemo(() => {
    const map = new Map<string, { id: string; label: string; ready: number; review: number }>();
    for (const line of lines) {
      const item = map.get(line.projectId) || {
        id: line.projectId,
        label: [line.projectNumber, line.projectName].filter(Boolean).join(" · "),
        ready: 0,
        review: 0,
      };
      if (line.disposition === "ready") item.ready += 1;
      if (line.disposition === "review") item.review += 1;
      map.set(line.projectId, item);
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [lines]);

  useEffect(() => {
    if (projectId || projects.length === 0) return;
    const firstReady = projects.find((project) => project.ready > 0);
    setProjectId(firstReady?.id || projects[0].id);
  }, [projectId, projects]);

  const visibleLines = useMemo(
    () => lines.filter((line) => !projectId || line.projectId === projectId),
    [lines, projectId]
  );
  const readyLines = visibleLines.filter((line) => line.disposition === "ready");
  const readyQuantity = readyLines.reduce((sum, line) => sum + line.proposedQuantity, 0);
  const summary = useMemo(() => ({
    ready: lines.filter((line) => line.disposition === "ready").length,
    review: lines.filter((line) => line.disposition === "review").length,
    complete: lines.filter((line) => line.disposition === "complete").length,
    seeded: lines.filter((line) => line.disposition === "seeded").length,
  }), [lines]);

  const runProject = async () => {
    if (!projectId || !accountingDate || readyLines.length === 0) return;
    const project = projects.find((item) => item.id === projectId);
    const measurement = closeoutType === "project_management_closeout" ? "hour" : "quantity";
    if (!window.confirm(`Create ${readyLines.length} ${closeoutLabel} closeout ${measurement} log${readyLines.length === 1 ? "" : "s"} for ${project?.label || projectId} on ${accountingDate}?`)) return;

    setRunning(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/procore/productivity-logs/forms-closeout", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          projectId,
          accountingDate,
          closeoutType,
          lineItemIds: readyLines.map((line) => line.lineItemId),
        }),
      });
      const data = (await response.json()) as RunResponse;
      if (!response.ok || !data.success) throw new Error(data.details || data.error || `Closeout failed (${response.status})`);
      setMessage(`${data.createdCount || 0} created · ${data.skippedCount || 0} skipped · ${data.failedCount || 0} failed`);
      await loadPreview();
      await onCompleted();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setRunning(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-3" role="dialog" aria-modal="true" aria-label="Administrative productivity closeout">
      <div className="flex max-h-[94vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 bg-slate-900 px-5 py-4 text-white">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-teal-300">Administrative productivity</p>
            <h2 className="mt-1 text-xl font-black">Administrative Closeout</h2>
            <p className="mt-1 text-xs font-semibold text-slate-300">Adds only the difference between expected and currently used amounts. Review lines are never created automatically.</p>
          </div>
          <button type="button" onClick={onClose} disabled={running} className="rounded-lg border border-white/20 px-3 py-1.5 text-xs font-black uppercase tracking-wider hover:bg-white/10 disabled:opacity-50">Close</button>
        </div>

        <div className="flex gap-2 border-b border-slate-200 bg-white px-4 pt-3">
          {([
            ["forms_closeout", "Forms"],
            ["project_management_closeout", "Project Management"],
          ] as Array<[CloseoutType, string]>).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => { setCloseoutType(value); setProjectId(""); setMessage(null); }}
              className={`rounded-t-lg border-x border-t px-4 py-2 text-xs font-black uppercase tracking-wider ${closeoutType === value ? "border-teal-300 bg-teal-50 text-teal-800" : "border-transparent text-slate-500 hover:bg-slate-50"}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2 border-b border-slate-200 bg-slate-50 p-4 sm:grid-cols-4">
          <div className="rounded-lg border border-teal-200 bg-teal-50 p-3"><p className="text-[10px] font-black uppercase text-teal-700">Ready</p><p className="text-xl font-black text-teal-900">{summary.ready}</p></div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3"><p className="text-[10px] font-black uppercase text-amber-700">Review</p><p className="text-xl font-black text-amber-900">{summary.review}</p></div>
          <div className="rounded-lg border border-slate-200 bg-white p-3"><p className="text-[10px] font-black uppercase text-slate-500">Complete</p><p className="text-xl font-black text-slate-800">{summary.complete}</p></div>
          <div className="rounded-lg border border-sky-200 bg-sky-50 p-3"><p className="text-[10px] font-black uppercase text-sky-700">Already seeded</p><p className="text-xl font-black text-sky-900">{summary.seeded}</p></div>
        </div>

        <div className="grid gap-3 border-b border-slate-200 p-4 md:grid-cols-[1fr_190px_auto] md:items-end">
          <div>
            <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Project</label>
            <select value={projectId} onChange={(event) => setProjectId(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700">
              {projects.map((project) => <option key={project.id} value={project.id}>{project.label} · {project.ready} ready</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Accounting date</label>
            <input type="date" value={accountingDate} onChange={(event) => setAccountingDate(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700" />
          </div>
          <button type="button" onClick={() => void runProject()} disabled={running || loading || !accountingDate || readyLines.length === 0} className="rounded-lg bg-teal-600 px-4 py-2.5 text-xs font-black uppercase tracking-wider text-white hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-50">
            {running ? "Creating…" : `Run ${readyLines.length} ready lines`}
          </button>
          <p className="text-[11px] font-semibold text-slate-500 md:col-span-3">Selected {closeoutLabel} project: {formatQuantity(readyQuantity)} total {closeoutType === "project_management_closeout" ? "hours" : "units"} proposed. Choose a deliberate administrative date; the tool does not default to today.</p>
        </div>

        {(error || message) && <div className={`mx-4 mt-4 rounded-lg border px-3 py-2 text-sm font-bold ${error ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{error || message}</div>}

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {loading ? <p className="py-12 text-center text-sm font-bold text-slate-500">Loading {closeoutLabel} candidates…</p> : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-left">
                <thead className="bg-slate-100 text-[10px] font-black uppercase tracking-wider text-slate-500"><tr><th className="px-3 py-2">PO / Line</th><th className="px-3 py-2">Description</th><th className="px-3 py-2">Code</th><th className="px-3 py-2 text-right">Expected</th><th className="px-3 py-2 text-right">Used</th><th className="px-3 py-2 text-right">Proposed</th><th className="px-3 py-2">Status</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleLines.map((line) => (
                    <tr key={line.lineItemId} className="align-top">
                      <td className="whitespace-nowrap px-3 py-3 text-xs font-bold text-slate-700"><p>{line.poNumber || line.poTitle || "No PO"} · {line.position ?? "—"}</p><p className="mt-1 font-mono text-[9px] text-slate-400">{line.lineItemId}</p></td>
                      <td className="max-w-sm px-3 py-3 text-xs font-bold text-slate-800">{line.description || "No description"}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-xs font-semibold text-slate-600">{line.costCode || "—"}<br /><span className="text-[10px] text-slate-400">{closeoutType === "project_management_closeout" ? "HRS" : (line.uom || "No UOM")}</span></td>
                      <td className="px-3 py-3 text-right text-xs font-black text-slate-800">{formatQuantity(line.expectedQuantity)}</td>
                      <td className="px-3 py-3 text-right text-xs font-black text-teal-700">{formatQuantity(line.usedQuantity)}</td>
                      <td className="px-3 py-3 text-right text-xs font-black text-slate-800">{line.disposition === "ready" ? formatQuantity(line.proposedQuantity) : "—"}</td>
                      <td className="max-w-xs px-3 py-3"><span className={`rounded px-2 py-1 text-[9px] font-black uppercase tracking-wider ${dispositionStyle(line.disposition)}`}>{line.disposition}</span><p className="mt-1.5 text-[10px] font-semibold leading-4 text-slate-500">{line.reason}</p></td>
                    </tr>
                  ))}
                  {visibleLines.length === 0 && <tr><td colSpan={7} className="py-12 text-center text-sm font-bold text-slate-500">No {closeoutLabel} candidates found for this project.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
