"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import Navigation from "@/components/Navigation";
import {
  commitmentMakerProjectIdFromSearch,
  parseCommitmentMakerRows,
  type CommitmentMakerParseResult,
} from "@/lib/procore/commitmentMaker";

type ProjectOption = {
  id: string;
  name: string;
  number: string;
  status: string;
};

type PreviewLine = {
  costCode: string;
  costType: string;
  description: string;
  quantity: number;
  uom: string;
  unitCost: number;
  wbsCodeId: string | null;
  wbsFlatCode: string | null;
};

type PreviewGroup = {
  name: string;
  number: string;
  action: "create" | "resume";
  existingContractId: string;
  lineItems: PreviewLine[];
  total: number;
};

type PreviewResponse = {
  success: boolean;
  error?: string;
  projectId: string;
  fileName: string;
  sheetName: string;
  previewFingerprint: string;
  sourceRowCount: number;
  skippedRows: number;
  warnings: string[];
  validationErrors: string[];
  vendor: {
    id: string;
    name: string;
    assignedToProject: boolean;
    willAddToProject: boolean;
  };
  contractType: string;
  finalStatus: string;
  groups: PreviewGroup[];
  totals: { groups: number; lineItems: number; amount: number };
};

type CreateResult = {
  success: boolean;
  error?: string;
  created: number;
  resumed: number;
  failed: number;
  results: Array<{
    success: boolean;
    group: string;
    number: string;
    contractId?: string | null;
    createdContract?: boolean;
    createdLineItems?: number;
    reusedLineItems?: number;
    status: string;
    error?: string;
  }>;
};

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function projectOptions(payload: unknown): ProjectOption[] {
  const root = asRecord(payload);
  const candidates = Array.isArray(payload)
    ? payload
    : Array.isArray(root.projects)
      ? root.projects
      : Array.isArray(root.data)
        ? root.data
        : [];
  return candidates
    .map((entry) => {
      const record = asRecord(entry);
      const project = asRecord(record.project);
      const id = text(record.id ?? record.project_id ?? record.procore_project_id ?? project.id);
      const name = text(record.name ?? record.project_name ?? record.display_name ?? project.name);
      const number = text(record.project_number ?? record.number ?? project.project_number ?? project.number);
      const status = text(record.status ?? record.project_status ?? project.status);
      return { id, name: name || id, number, status };
    })
    .filter((project) => project.id)
    .sort((a, b) => `${a.number} ${a.name}`.localeCompare(`${b.number} ${b.name}`));
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value || 0);
}

export default function CommitmentMakerPage() {
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectsBusy, setProjectsBusy] = useState(true);
  const [projectId, setProjectId] = useState("");
  const [projectLocked, setProjectLocked] = useState(false);
  const [fileName, setFileName] = useState("");
  const [workbookBuffer, setWorkbookBuffer] = useState<ArrayBuffer | null>(null);
  const [parsedWorkbook, setParsedWorkbook] = useState<CommitmentMakerParseResult | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [sheetName, setSheetName] = useState("");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [result, setResult] = useState<CreateResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === projectId) || null,
    [projects, projectId]
  );

  useEffect(() => {
    let cancelled = false;
    async function loadProjects() {
      try {
        const linkedProjectId = commitmentMakerProjectIdFromSearch(window.location.search);
        if (linkedProjectId) {
          if (!cancelled) {
            setProjectId(linkedProjectId);
            setProjectLocked(true);
            setProjects([{
              id: linkedProjectId,
              name: "Loading project…",
              number: "",
              status: "",
            }]);
          }

          const search = new URLSearchParams(window.location.search);
          const accessToken = text(search.get("access"));
          const response = await fetch(
            `/api/procore/commitments-live/maker?projectId=${encodeURIComponent(linkedProjectId)}`,
            {
              cache: "no-store",
              headers: {
                "X-Commitment-Maker-Project-Id": linkedProjectId,
                "X-Commitment-Maker-Access": accessToken,
              },
            }
          );
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(text(asRecord(payload).error) || "The Procore project name could not be loaded.");
          }
          const project = asRecord(asRecord(payload).project);
          if (!cancelled) {
            setProjects([{
              id: text(project.id) || linkedProjectId,
              name: text(project.name) || `Project ${linkedProjectId}`,
              number: text(project.number),
              status: text(project.status),
            }]);
          }
          return;
        }
        const response = await fetch("/api/procore/projects", { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(text(asRecord(payload).error) || "Projects could not be loaded.");
        if (!cancelled) {
          const options = projectOptions(payload);
          setProjects(options);
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError));
      } finally {
        if (!cancelled) setProjectsBusy(false);
      }
    }
    void loadProjects();
    return () => {
      cancelled = true;
    };
  }, []);

  function invalidatePreview() {
    setPreview(null);
    setResult(null);
    setConfirmed(false);
    setExpandedGroups({});
  }

  async function handleFile(file: File | null) {
    invalidatePreview();
    setError("");
    setFileName("");
    setWorkbookBuffer(null);
    setParsedWorkbook(null);
    setSheetNames([]);
    setSheetName("");
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      setError("The workbook exceeds the 15 MB upload limit.");
      return;
    }
    try {
      const buffer = await file.arrayBuffer();
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(buffer, { type: "array" });
      const names = workbook.SheetNames || [];
      if (names.length === 0) throw new Error("The workbook has no readable worksheets.");
      setFileName(file.name);
      setWorkbookBuffer(buffer);
      setSheetNames(names);
      setSheetName(names[0]);
      const rows = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(workbook.Sheets[names[0]], {
        header: 1,
        raw: false,
        defval: "",
      });
      setParsedWorkbook(parseCommitmentMakerRows(rows, { fallbackGroupName: file.name.replace(/\.[^.]+$/, "") }));
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : String(uploadError));
    }
  }

  async function handleSheetChange(nextSheetName: string) {
    setSheetName(nextSheetName);
    invalidatePreview();
    setError("");
    setParsedWorkbook(null);
    if (!nextSheetName || !workbookBuffer) return;
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(workbookBuffer, { type: "array" });
      const sheet = workbook.Sheets[nextSheetName];
      if (!sheet) throw new Error(`Worksheet "${nextSheetName}" could not be read.`);
      const rows = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
        header: 1,
        raw: false,
        defval: "",
      });
      setParsedWorkbook(parseCommitmentMakerRows(rows, { fallbackGroupName: fileName.replace(/\.[^.]+$/, "") }));
    } catch (sheetError) {
      setError(sheetError instanceof Error ? sheetError.message : String(sheetError));
    }
  }

  async function callMaker(mode: "preview" | "create") {
    setBusy(true);
    setError("");
    if (mode === "create") setResult(null);
    try {
      const response = await fetch("/api/procore/commitments-live/maker", {
        method: "POST",
        headers: (() => {
          const headers: Record<string, string> = { "Content-Type": "application/json" };
          const search = new URLSearchParams(window.location.search);
          const linkedProjectId = commitmentMakerProjectIdFromSearch(window.location.search);
          const accessToken = text(search.get("access"));
          if (linkedProjectId && linkedProjectId === projectId && accessToken) {
            headers["X-Commitment-Maker-Project-Id"] = linkedProjectId;
            headers["X-Commitment-Maker-Access"] = accessToken;
          }
          return headers;
        })(),
        body: JSON.stringify({
          mode,
          projectId,
          fileName,
          sheetName,
          groups: parsedWorkbook?.groups,
          sourceRowCount: parsedWorkbook?.sourceRowCount,
          skippedRows: parsedWorkbook?.skippedRows,
          warnings: parsedWorkbook?.warnings,
          previewFingerprint: mode === "create" ? preview?.previewFingerprint : undefined,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (mode === "preview") {
        const nextPreview = payload as PreviewResponse;
        setPreview(nextPreview);
        setResult(null);
        setConfirmed(false);
        setExpandedGroups(
          Object.fromEntries((nextPreview.groups || []).map((group, index) => [group.name, index === 0]))
        );
      } else if (Array.isArray(asRecord(payload).results)) {
        setResult(payload as CreateResult);
      }
      if (!response.ok) throw new Error(text(asRecord(payload).error) || "The request failed.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setBusy(false);
    }
  }

  const readyToPreview = Boolean(projectId && parsedWorkbook && sheetName && !busy);
  const readyToCreate = Boolean(preview?.success && confirmed && !busy && !result?.success);

  return (
    <div className="min-h-screen bg-slate-100">
      {!projectLocked && <Navigation />}

      <main className="mx-auto w-full max-w-[1500px] space-y-5 px-4 py-8">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-indigo-700">Procore Commitments</p>
              <h1 className="mt-1 text-2xl font-black text-slate-900">Commitment Maker</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-600">
                Turn an estimate workbook into approved Procore purchase orders. Each estimate group becomes one PO.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                href="https://pmc-tg-web.github.io/commitment_converter/Commitment_Maker.html"
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-black uppercase tracking-wider text-slate-700 hover:bg-slate-50"
              >
                Legacy CSV Converter
              </a>
              <Link
                href="/procore/commitments-live"
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-black uppercase tracking-wider text-slate-700 hover:bg-slate-50"
              >
                Commitment Lines
              </Link>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <label className="block">
              <span className="text-xs font-black uppercase tracking-wider text-slate-600">1. Procore Project</span>
              <select
                value={projectId}
                disabled={projectsBusy || busy || projectLocked}
                onChange={(event) => {
                  setProjectId(event.target.value);
                  invalidatePreview();
                }}
                className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900"
              >
                <option value="">{projectsBusy ? "Loading projects..." : "Select a project"}</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {[project.number, project.name, project.status].filter(Boolean).join(" — ")}
                  </option>
                ))}
              </select>
              {projectLocked && (
                <p className="mt-1.5 text-xs font-semibold text-emerald-700">
                  Locked to the project that opened this link in Procore.
                </p>
              )}
            </label>

            <label className="block">
              <span className="text-xs font-black uppercase tracking-wider text-slate-600">2. Estimate Workbook</span>
              <input
                type="file"
                accept=".xlsx,.xls"
                disabled={busy}
                onChange={(event) => void handleFile(event.target.files?.[0] || null)}
                className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
              />
            </label>

            <label className="block">
              <span className="text-xs font-black uppercase tracking-wider text-slate-600">3. Worksheet</span>
              <select
                value={sheetName}
                disabled={!sheetNames.length || busy}
                onChange={(event) => void handleSheetChange(event.target.value)}
                className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900"
              >
                <option value="">Select a worksheet</option>
                {sheetNames.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={!readyToPreview}
              onClick={() => void callMaker("preview")}
              className="rounded-lg bg-indigo-700 px-5 py-2.5 text-sm font-black text-white hover:bg-indigo-800 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {busy ? "Checking Procore..." : "Preview and Validate"}
            </button>
            <p className="text-xs text-slate-500">
              Previewing does not create or change anything in Procore.
            </p>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            ["Vendor", "Paradise Masonry, LLC"],
            ["Type", "Purchase Order"],
            ["Title", "Estimate group name"],
            ["Final Status", "Approved"],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">{label}</p>
              <p className="mt-1 text-sm font-bold text-slate-900">{value}</p>
            </div>
          ))}
        </section>

        {error && (
          <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
            {error}
          </div>
        )}

        {preview && (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-black text-slate-900">Validated Preview</h2>
                <p className="mt-1 text-sm text-slate-600">
                  {selectedProject ? `${selectedProject.number} — ${selectedProject.name}` : preview.projectId} · {preview.fileName} · {preview.sheetName}
                </p>
              </div>
              <div className={`rounded-lg px-4 py-2 text-sm font-black ${preview.success ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
                {preview.success ? "Ready to create" : "Creation blocked"}
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
              <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">POs</p><p className="text-lg font-black">{preview.totals.groups}</p></div>
              <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Line items</p><p className="text-lg font-black">{preview.totals.lineItems}</p></div>
              <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Total</p><p className="text-lg font-black">{formatCurrency(preview.totals.amount)}</p></div>
              <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Source rows</p><p className="text-lg font-black">{preview.sourceRowCount}</p></div>
              <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Rows excluded</p><p className="text-lg font-black">{preview.skippedRows}</p></div>
            </div>

            <div className="mt-4 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
              <strong>{preview.vendor.name}</strong> {preview.vendor.assignedToProject ? "is assigned to this project." : "will be added to this project before the POs are created."}
            </div>

            {preview.validationErrors.length > 0 && (
              <div className="mt-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
                <p className="font-black">Fix these items before creating:</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {preview.validationErrors.map((message) => <li key={message}>{message}</li>)}
                </ul>
              </div>
            )}

            {preview.warnings.length > 0 && (
              <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {preview.warnings.map((message) => <p key={message}>{message}</p>)}
              </div>
            )}

            <div className="mt-5 space-y-3">
              {preview.groups.map((group) => {
                const expanded = expandedGroups[group.name] === true;
                return (
                  <div key={group.name} className="overflow-hidden rounded-xl border border-slate-200">
                    <button
                      type="button"
                      onClick={() => setExpandedGroups((current) => ({ ...current, [group.name]: !expanded }))}
                      className="flex w-full items-center justify-between gap-4 bg-slate-50 px-4 py-3 text-left hover:bg-slate-100"
                    >
                      <span>
                        <span className="font-black text-slate-900">PO {group.number} — {group.name}</span>
                        <span className="ml-2 text-xs font-semibold text-slate-500">{group.lineItems.length} lines · {formatCurrency(group.total)}</span>
                      </span>
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${group.action === "resume" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
                        {group.action === "resume" ? "Resume existing" : "New PO"}
                      </span>
                    </button>
                    {expanded && (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[900px] text-left text-xs">
                          <thead className="bg-white text-slate-500">
                            <tr>
                              <th className="px-3 py-2">Budget Code</th>
                              <th className="px-3 py-2">Description</th>
                              <th className="px-3 py-2 text-right">Quantity</th>
                              <th className="px-3 py-2">UOM</th>
                              <th className="px-3 py-2 text-right">Unit Cost</th>
                              <th className="px-3 py-2 text-right">Amount</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {group.lineItems.map((line, index) => (
                              <tr key={`${line.wbsCodeId}-${line.description}-${index}`}>
                                <td className="px-3 py-2 font-mono font-semibold">{line.wbsFlatCode || `${line.costCode} (unassigned)`}</td>
                                <td className="px-3 py-2">{line.description}</td>
                                <td className="px-3 py-2 text-right">{line.quantity}</td>
                                <td className="px-3 py-2">{line.uom}</td>
                                <td className="px-3 py-2 text-right">{formatCurrency(line.unitCost)}</td>
                                <td className="px-3 py-2 text-right font-semibold">{formatCurrency(line.quantity * line.unitCost)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {preview.success && !result?.success && (
              <div className="mt-6 rounded-xl border-2 border-indigo-300 bg-indigo-50 p-4">
                <label className="flex items-start gap-3 text-sm font-semibold text-indigo-950">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                    className="mt-0.5 h-4 w-4"
                  />
                  <span>I reviewed the project, PO numbers, groups, budget codes, quantities, and costs above.</span>
                </label>
                <button
                  type="button"
                  disabled={!readyToCreate}
                  onClick={() => void callMaker("create")}
                  className="mt-4 rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-black text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                >
                  {busy ? "Creating Purchase Orders..." : `Create ${preview.totals.groups} Approved Purchase Order${preview.totals.groups === 1 ? "" : "s"}`}
                </button>
                <p className="mt-2 text-xs text-indigo-800">
                  Each PO is staged as Draft while its line items are added, then changed to Approved after the PO is complete.
                </p>
              </div>
            )}
          </section>
        )}

        {result && (
          <section className={`rounded-2xl border p-6 shadow-sm ${result.success ? "border-emerald-300 bg-emerald-50" : "border-red-300 bg-red-50"}`}>
            <h2 className={`text-lg font-black ${result.success ? "text-emerald-900" : "text-red-900"}`}>
              {result.success ? "Commitments created successfully" : "Commitment creation needs attention"}
            </h2>
            <p className="mt-1 text-sm">
              Created {result.created || 0}, resumed {result.resumed || 0}, failed {result.failed || 0}.
            </p>
            {result.error && <p className="mt-2 text-sm font-semibold text-red-800">{result.error}</p>}
            <div className="mt-4 space-y-2">
              {(result.results || []).map((item) => (
                <div key={`${item.group}-${item.contractId || item.number}`} className="rounded-lg border border-white/80 bg-white px-4 py-3 text-sm">
                  <p className="font-black">PO {item.number} — {item.group}</p>
                  <p className="mt-1 text-xs text-slate-600">
                    {item.status}{item.contractId ? ` · Procore ID ${item.contractId}` : ""}
                    {item.createdLineItems !== undefined ? ` · ${item.createdLineItems} lines created` : ""}
                    {item.reusedLineItems ? ` · ${item.reusedLineItems} existing lines reused` : ""}
                  </p>
                  {item.error && <p className="mt-2 text-xs font-semibold text-red-700">{item.error}</p>}
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
