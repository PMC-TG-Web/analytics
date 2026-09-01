"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import Navigation from "@/components/Navigation";
import {
  combineCommitmentMakerGroups,
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

type ApprovedChangeOrder = {
  packageId: string;
  contractId: string;
  number: string;
  title: string;
  status: string;
  amount: number | null;
  updatedAt: string;
  sourceKind: "change_order_package" | "potential_change_order";
};

type ExistingCommitment = {
  id: string;
  number: string;
  title: string;
  status: string;
  vendorId: string;
  vendorName: string;
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
  action: "create" | "resume" | "append";
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
  sourceType: "estimate" | "approved_change_order";
  sourceChangeOrder: ApprovedChangeOrder | null;
  target: "new_purchase_order" | "existing_purchase_order";
  existingCommitmentId: string;
  taskAssignees: {
    shellyAssigneeId: number;
    projectManagerAssigneeIds: number[];
  } | null;
  groups: PreviewGroup[];
  totals: { groups: number; lineItems: number; amount: number };
};

type CreateResult = {
  success: boolean;
  error?: string;
  created: number;
  resumed: number;
  failed: number;
  addedToExisting?: number;
  sourceChangeOrder?: ApprovedChangeOrder | null;
  taskError?: string;
  tasksQueued?: boolean;
  taskResult?: {
    tasks: Array<{
      kind: "aia_billing" | "commitment_verification";
      taskId: string;
      title: string;
      created: boolean;
      updated: boolean;
      notified: boolean;
    }>;
  } | null;
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
  const [sourceType, setSourceType] = useState<"estimate" | "approved_change_order">("estimate");
  const [approvedChangeOrders, setApprovedChangeOrders] = useState<ApprovedChangeOrder[]>([]);
  const [changeOrdersBusy, setChangeOrdersBusy] = useState(false);
  const [changeOrderWarning, setChangeOrderWarning] = useState("");
  const [changeOrderPackageId, setChangeOrderPackageId] = useState("");
  const [commitmentTarget, setCommitmentTarget] = useState<"new_purchase_order" | "existing_purchase_order">("new_purchase_order");
  const [existingCommitments, setExistingCommitments] = useState<ExistingCommitment[]>([]);
  const [existingCommitmentId, setExistingCommitmentId] = useState("");
  const [fileName, setFileName] = useState("");
  const [workbookBuffer, setWorkbookBuffer] = useState<ArrayBuffer | null>(null);
  const [parsedWorkbook, setParsedWorkbook] = useState<CommitmentMakerParseResult | null>(null);
  const [originalParsedWorkbook, setOriginalParsedWorkbook] = useState<CommitmentMakerParseResult | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [sheetName, setSheetName] = useState("");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [result, setResult] = useState<CreateResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [combineSelection, setCombineSelection] = useState<Record<string, boolean>>({});
  const [combinedGroupName, setCombinedGroupName] = useState("");
  const [combineMessage, setCombineMessage] = useState("");

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === projectId) || null,
    [projects, projectId]
  );
  const selectedChangeOrder = useMemo(
    () => approvedChangeOrders.find((changeOrder) => changeOrder.packageId === changeOrderPackageId) || null,
    [approvedChangeOrders, changeOrderPackageId],
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

  useEffect(() => {
    let cancelled = false;
    async function loadApprovedChangeOrders() {
      setApprovedChangeOrders([]);
      setExistingCommitments([]);
      setChangeOrderPackageId("");
      setExistingCommitmentId("");
      setChangeOrderWarning("");
      if (!projectId) return;
      setChangeOrdersBusy(true);
      try {
        const search = new URLSearchParams(window.location.search);
        const linkedProjectId = commitmentMakerProjectIdFromSearch(window.location.search);
        const accessToken = text(search.get("access"));
        const headers: Record<string, string> = {};
        if (linkedProjectId === projectId && accessToken) {
          headers["X-Commitment-Maker-Project-Id"] = linkedProjectId;
          headers["X-Commitment-Maker-Access"] = accessToken;
        }
        const response = await fetch(
          `/api/procore/commitments-live/maker?projectId=${encodeURIComponent(projectId)}`,
          { cache: "no-store", headers },
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(text(asRecord(payload).error) || "Approved change orders could not be loaded.");
        }
        const records = Array.isArray(asRecord(payload).approvedChangeOrders)
          ? asRecord(payload).approvedChangeOrders as ApprovedChangeOrder[]
          : [];
        const commitments = Array.isArray(asRecord(payload).existingCommitments)
          ? asRecord(payload).existingCommitments as ExistingCommitment[]
          : [];
        if (!cancelled) {
          const project = asRecord(asRecord(payload).project);
          if (linkedProjectId === projectId) {
            setProjects([{
              id: text(project.id) || projectId,
              name: text(project.name) || `Project ${projectId}`,
              number: text(project.number),
              status: text(project.status),
            }]);
          }
          setApprovedChangeOrders(records);
          setExistingCommitments(commitments);
          setChangeOrderWarning(text(asRecord(payload).changeOrderWarning));
        }
      } catch (loadError) {
        if (!cancelled) {
          setChangeOrderWarning(loadError instanceof Error ? loadError.message : String(loadError));
        }
      } finally {
        if (!cancelled) setChangeOrdersBusy(false);
      }
    }
    void loadApprovedChangeOrders();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  function invalidatePreview() {
    setPreview(null);
    setResult(null);
    setConfirmed(false);
    setExpandedGroups({});
    setCombineSelection({});
    setCombinedGroupName("");
    setCombineMessage("");
  }

  async function handleFile(file: File | null) {
    invalidatePreview();
    setError("");
    setFileName("");
    setWorkbookBuffer(null);
    setParsedWorkbook(null);
    setOriginalParsedWorkbook(null);
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
      const parsed = parseCommitmentMakerRows(rows, { fallbackGroupName: file.name.replace(/\.[^.]+$/, "") });
      setParsedWorkbook(parsed);
      setOriginalParsedWorkbook(parsed);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : String(uploadError));
    }
  }

  async function handleSheetChange(nextSheetName: string) {
    setSheetName(nextSheetName);
    invalidatePreview();
    setError("");
    setParsedWorkbook(null);
    setOriginalParsedWorkbook(null);
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
      const parsed = parseCommitmentMakerRows(rows, { fallbackGroupName: fileName.replace(/\.[^.]+$/, "") });
      setParsedWorkbook(parsed);
      setOriginalParsedWorkbook(parsed);
    } catch (sheetError) {
      setError(sheetError instanceof Error ? sheetError.message : String(sheetError));
    }
  }

  async function callMaker(
    mode: "preview" | "create",
    parsedOverride: CommitmentMakerParseResult | null = parsedWorkbook,
  ) {
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
          groups: parsedOverride?.groups,
          sourceRowCount: parsedOverride?.sourceRowCount,
          skippedRows: parsedOverride?.skippedRows,
          warnings: parsedOverride?.warnings,
          changeOrderPackageId: sourceType === "approved_change_order" ? changeOrderPackageId : undefined,
          target: sourceType === "approved_change_order" ? commitmentTarget : "new_purchase_order",
          existingCommitmentId: sourceType === "approved_change_order" && commitmentTarget === "existing_purchase_order"
            ? existingCommitmentId
            : undefined,
          previewFingerprint: mode === "create" ? preview?.previewFingerprint : undefined,
        }),
      });
      const responseText = await response.text();
      let payload: unknown = {};
      try {
        payload = responseText ? JSON.parse(responseText) : {};
      } catch {
        payload = {};
      }
      if (!response.ok && mode === "preview") {
        throw new Error(
          text(asRecord(payload).error)
          || `The request failed (${response.status}). No Procore changes were confirmed; refresh and retry.`,
        );
      }
      if (mode === "preview") {
        const nextPreview = payload as PreviewResponse;
        if (
          typeof nextPreview.success !== "boolean"
          || !Array.isArray(nextPreview.groups)
          || !Array.isArray(nextPreview.warnings)
          || !Array.isArray(nextPreview.validationErrors)
          || !nextPreview.totals
        ) {
          throw new Error("Procore returned an incomplete preview. Refresh and try again.");
        }
        setPreview(nextPreview);
        setResult(null);
        setConfirmed(false);
        setCombineSelection({});
        setCombinedGroupName("");
        setExpandedGroups(
          Object.fromEntries((nextPreview.groups || []).map((group, index) => [group.name, index === 0]))
        );
      } else if (Array.isArray(asRecord(payload).results)) {
        setResult(payload as CreateResult);
      }
      if (!response.ok) {
        throw new Error(
          text(asRecord(payload).error)
          || `The request failed (${response.status}). No Procore changes were confirmed; refresh and retry.`,
        );
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function combineSelectedGroups() {
    if (!parsedWorkbook || !preview) return;
    const selectedNames = preview.groups
      .filter((group) => combineSelection[group.name] === true)
      .map((group) => group.name);
    const selectedExisting = preview.groups.filter((group) => (
      combineSelection[group.name] === true && group.action === "resume"
    ));
    if (selectedExisting.length > 0) {
      setError("Existing Procore purchase orders cannot be combined here. Only new proposed POs can be combined before creation.");
      return;
    }
    try {
      setError("");
      const combinedGroups = combineCommitmentMakerGroups(
        parsedWorkbook.groups,
        selectedNames,
        combinedGroupName,
      );
      const nextParsed = { ...parsedWorkbook, groups: combinedGroups };
      setParsedWorkbook(nextParsed);
      setPreview(null);
      setResult(null);
      setConfirmed(false);
      setExpandedGroups({});
      setCombineSelection({});
      setCombinedGroupName("");
      setCombineMessage(`Combined ${selectedNames.length} proposed POs into "${combinedGroupName.trim()}" and consolidated matching quantities.`);
      await callMaker("preview", nextParsed);
    } catch (combineError) {
      setError(combineError instanceof Error ? combineError.message : String(combineError));
    }
  }

  async function resetCombinedGroups() {
    if (!originalParsedWorkbook) return;
    setParsedWorkbook(originalParsedWorkbook);
    setPreview(null);
    setResult(null);
    setConfirmed(false);
    setExpandedGroups({});
    setCombineSelection({});
    setCombinedGroupName("");
    setCombineMessage("Restored the original estimate groupings.");
    await callMaker("preview", originalParsedWorkbook);
  }

  const readyToPreview = Boolean(
    projectId
    && (sourceType === "approved_change_order" || (parsedWorkbook && sheetName))
    && !busy
    && (sourceType === "estimate" || changeOrderPackageId)
    && (sourceType === "estimate" || commitmentTarget === "new_purchase_order" || existingCommitmentId)
  );
  const selectedCombineNames = preview?.groups
    .filter((group) => combineSelection[group.name] === true)
    .map((group) => group.name) || [];
  const combinableGroupCount = preview?.groups.filter((group) => group.action === "create").length || 0;
  const groupingChanged = Boolean(
    parsedWorkbook
    && originalParsedWorkbook
    && JSON.stringify(parsedWorkbook.groups) !== JSON.stringify(originalParsedWorkbook.groups)
  );
  const readyToCombine = Boolean(selectedCombineNames.length >= 2 && combinedGroupName.trim() && !busy);
  const readyToCreate = Boolean(
    preview?.success && confirmed && selectedCombineNames.length === 0 && !busy && !result?.success
  );

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
                Turn an estimate into approved purchase orders, or add approved Procore change-order lines to a new or existing PO.
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

          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
            <label className="block">
              <span className="text-xs font-black uppercase tracking-wider text-slate-600">1. Procore Project</span>
              <select
                value={projectId}
                disabled={projectsBusy || busy || projectLocked}
                onChange={(event) => {
                  setProjectId(event.target.value);
                  setSourceType("estimate");
                  setChangeOrderPackageId("");
                  setCommitmentTarget("new_purchase_order");
                  setExistingCommitmentId("");
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
              <span className="text-xs font-black uppercase tracking-wider text-slate-600">2. Work Source</span>
              <select
                value={sourceType}
                disabled={busy || !projectId}
                onChange={(event) => {
                  const nextSource = event.target.value === "approved_change_order"
                    ? "approved_change_order"
                    : "estimate";
                  setSourceType(nextSource);
                  setChangeOrderPackageId("");
                  setCommitmentTarget("new_purchase_order");
                  setExistingCommitmentId("");
                  invalidatePreview();
                }}
                className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900"
              >
                <option value="estimate">Base Estimate</option>
                <option value="approved_change_order">Approved Change Order</option>
              </select>
            </label>

            {sourceType === "approved_change_order" && (
              <label className="block xl:col-span-2">
                <span className="text-xs font-black uppercase tracking-wider text-slate-600">3. Approved Change Order</span>
                <select
                  value={changeOrderPackageId}
                  disabled={busy || changeOrdersBusy || !projectId}
                  onChange={(event) => {
                    setChangeOrderPackageId(event.target.value);
                    invalidatePreview();
                  }}
                  className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900"
                >
                  <option value="">
                    {changeOrdersBusy
                      ? "Loading approved change orders..."
                      : approvedChangeOrders.length
                        ? "Select an approved change order"
                        : "No approved change orders found"}
                  </option>
                  {approvedChangeOrders.map((changeOrder) => (
                    <option key={changeOrder.packageId} value={changeOrder.packageId}>
                      {[`CO ${changeOrder.number || changeOrder.packageId}`, changeOrder.title, formatCurrency(changeOrder.amount || 0)]
                        .filter(Boolean)
                        .join(" — ")}
                    </option>
                  ))}
                </select>
                  {changeOrderWarning && (
                  <p className="mt-1.5 text-xs font-semibold text-amber-700">{changeOrderWarning}</p>
                )}
              </label>
            )}

            {sourceType === "approved_change_order" ? (
              <>
                <label className="block">
                  <span className="text-xs font-black uppercase tracking-wider text-slate-600">4. Add CO To</span>
                  <select
                    value={commitmentTarget}
                    disabled={busy || !changeOrderPackageId}
                    onChange={(event) => {
                      setCommitmentTarget(event.target.value === "existing_purchase_order" ? "existing_purchase_order" : "new_purchase_order");
                      setExistingCommitmentId("");
                      invalidatePreview();
                    }}
                    className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900"
                  >
                    <option value="new_purchase_order">New Purchase Order</option>
                    <option value="existing_purchase_order">Existing Purchase Order</option>
                  </select>
                </label>
                {commitmentTarget === "existing_purchase_order" && (
                  <label className="block xl:col-span-2">
                    <span className="text-xs font-black uppercase tracking-wider text-slate-600">5. Existing Purchase Order</span>
                    <select
                      value={existingCommitmentId}
                      disabled={busy || !changeOrderPackageId}
                      onChange={(event) => {
                        setExistingCommitmentId(event.target.value);
                        invalidatePreview();
                      }}
                      className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900"
                    >
                      <option value="">Select an existing purchase order</option>
                      {existingCommitments.map((commitment) => (
                        <option key={commitment.id} value={commitment.id}>
                          {[`PO ${commitment.number || commitment.id}`, commitment.title, commitment.vendorName, commitment.status]
                            .filter(Boolean)
                            .join(" — ")}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            ) : (
              <>
                <label className="block">
                  <span className="text-xs font-black uppercase tracking-wider text-slate-600">3. Estimate Workbook</span>
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    disabled={busy}
                    onChange={(event) => void handleFile(event.target.files?.[0] || null)}
                    className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-black uppercase tracking-wider text-slate-600">4. Worksheet</span>
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
              </>
            )}
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

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          {[
            [
              "Source",
              sourceType === "approved_change_order"
                ? selectedChangeOrder
                  ? `CO ${selectedChangeOrder.number || selectedChangeOrder.packageId} — ${selectedChangeOrder.title}`
                  : "Select an approved change order"
                : "Base Estimate",
            ],
            ["Vendor", "Paradise Masonry, LLC"],
            ["Type", sourceType === "approved_change_order" && commitmentTarget === "existing_purchase_order" ? "Purchase Order Lines" : "Purchase Order"],
            ["Title", sourceType === "approved_change_order" ? "Selected approved change order" : "Estimate group or combined name"],
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
                  {selectedProject ? `${selectedProject.number} — ${selectedProject.name}` : preview.projectId}
                  {preview.sourceType === "estimate" ? ` · ${preview.fileName} · ${preview.sheetName}` : " · Live Procore change-order lines"}
                </p>
                {preview.sourceChangeOrder && (
                  <p className="mt-1 text-sm font-bold text-indigo-700">
                    CO {preview.sourceChangeOrder.number || preview.sourceChangeOrder.packageId} — {preview.sourceChangeOrder.title}
                  </p>
                )}
              </div>
              <div className={`rounded-lg px-4 py-2 text-sm font-black ${preview.success ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
                {preview.success ? "Ready to create" : "Creation blocked"}
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
              <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">{preview.target === "existing_purchase_order" ? "Target POs" : "POs"}</p><p className="text-lg font-black">{preview.totals.groups}</p></div>
              <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Line items</p><p className="text-lg font-black">{preview.totals.lineItems}</p></div>
              <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Total</p><p className="text-lg font-black">{formatCurrency(preview.totals.amount)}</p></div>
              <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Source rows</p><p className="text-lg font-black">{preview.sourceRowCount}</p></div>
              <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Rows excluded</p><p className="text-lg font-black">{preview.skippedRows}</p></div>
            </div>

            <div className="mt-4 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
              <strong>{preview.vendor.name}</strong> {preview.vendor.assignedToProject ? "is assigned to this project." : "will be added to this project before the POs are created."}
            </div>

            {preview.sourceChangeOrder && preview.taskAssignees && (
              <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                Follow-up task assignees verified: Shelly Swinehart and {preview.taskAssignees.projectManagerAssigneeIds.length} internal project manager{preview.taskAssignees.projectManagerAssigneeIds.length === 1 ? "" : "s"}. Both tasks will be sent automatically after the commitment finishes.
              </div>
            )}

            {combineMessage && (
              <div className="mt-4 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">
                {combineMessage}
              </div>
            )}

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

            {combinableGroupCount >= 2 && (
              <div className="mt-5 rounded-xl border-2 border-violet-200 bg-violet-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-black text-violet-950">Combine proposed purchase orders</h3>
                    <p className="mt-1 text-xs text-violet-800">
                      Select two or more new POs below. Matching budget code, description, UOM, cost type, and unit cost lines will become one line with the quantities added together.
                    </p>
                  </div>
                  {groupingChanged && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void resetCombinedGroups()}
                      className="rounded-lg border border-violet-300 bg-white px-3 py-2 text-xs font-black text-violet-800 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Reset Original Groups
                    </button>
                  )}
                </div>
                <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-end">
                  <label className="block flex-1">
                    <span className="text-xs font-black uppercase tracking-wider text-violet-800">Combined PO title</span>
                    <input
                      type="text"
                      maxLength={255}
                      value={combinedGroupName}
                      disabled={busy}
                      onChange={(event) => setCombinedGroupName(event.target.value)}
                      placeholder="Enter the title for the combined PO"
                      className="mt-1.5 w-full rounded-lg border border-violet-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={!readyToCombine}
                    onClick={() => void combineSelectedGroups()}
                    className="rounded-lg bg-violet-700 px-5 py-2.5 text-sm font-black text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                  >
                    {busy ? "Revalidating..." : `Combine ${selectedCombineNames.length} Selected POs`}
                  </button>
                </div>
                <p className="mt-2 text-xs font-semibold text-violet-800">
                  {selectedCombineNames.length} selected. Existing or previously resumed Procore POs are protected and cannot be combined here.
                </p>
              </div>
            )}

            <div className="mt-5 space-y-3">
              {preview.groups.map((group) => {
                const expanded = expandedGroups[group.name] === true;
                return (
                  <div key={group.name} className="overflow-hidden rounded-xl border border-slate-200">
                    <div className="flex items-stretch bg-slate-50">
                      {combinableGroupCount >= 2 && (
                        <label
                          className={`flex items-center border-r border-slate-200 px-4 ${group.action === "resume" ? "cursor-not-allowed bg-slate-100" : "cursor-pointer hover:bg-violet-100"}`}
                          title={group.action === "resume" ? "Existing Procore POs cannot be combined." : "Select this proposed PO to combine."}
                        >
                          <input
                            type="checkbox"
                            aria-label={`Select PO ${group.number} ${group.name} to combine`}
                            checked={combineSelection[group.name] === true}
                            disabled={busy || group.action === "resume"}
                            onChange={(event) => {
                              setConfirmed(false);
                              setCombineSelection((current) => ({ ...current, [group.name]: event.target.checked }));
                            }}
                            className="h-5 w-5 rounded border-slate-300 text-violet-700"
                          />
                        </label>
                      )}
                      <button
                        type="button"
                        onClick={() => setExpandedGroups((current) => ({ ...current, [group.name]: !expanded }))}
                        className="flex flex-1 items-center justify-between gap-4 px-4 py-3 text-left hover:bg-slate-100"
                      >
                        <span>
                          <span className="font-black text-slate-900">
                            PO {group.number} — {group.name}
                          </span>
                          <span className="ml-2 text-xs font-semibold text-slate-500">{group.lineItems.length} lines · {formatCurrency(group.total)}</span>
                        </span>
                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${group.action === "resume" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
                          {group.action === "append" ? "Append lines" : group.action === "resume" ? "Resume existing" : "New PO"}
                        </span>
                      </button>
                    </div>
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
                  <span>
                    I reviewed the project, {preview.sourceChangeOrder ? "approved change order, " : ""}{preview.target === "existing_purchase_order" ? "target PO, " : "PO numbers, groups, "}budget codes, quantities, and costs above.
                  </span>
                </label>
                <button
                  type="button"
                  disabled={!readyToCreate}
                  onClick={() => void callMaker("create")}
                  className="mt-4 rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-black text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                >
                  {busy
                    ? preview.target === "existing_purchase_order" ? "Adding Lines..." : "Creating Purchase Orders..."
                    : preview.target === "existing_purchase_order"
                      ? "Add PCO Lines to Existing PO"
                      : `Create ${preview.totals.groups} Approved Purchase Order${preview.totals.groups === 1 ? "" : "s"}`}
                </button>
                <p className="mt-2 text-xs text-indigo-800">
                  {preview.target === "existing_purchase_order"
                    ? "Only missing PCO lines are added directly to the selected purchase order. No commitment change order is created."
                    : "Each PO is staged as Draft while its line items are added, then changed to Approved after the PO is complete."}
                  {preview.sourceChangeOrder
                    ? " After successful creation, Shelly and the project manager will receive their Procore follow-up tasks."
                    : ""}
                </p>
                {selectedCombineNames.length > 0 && (
                  <p className="mt-2 text-xs font-black text-violet-800">
                    Combine the selected POs or clear their selections before creating.
                  </p>
                )}
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
              Created {result.created || 0} PO(s), updated {result.addedToExisting || 0} existing PO(s), resumed {result.resumed || 0}, failed {result.failed || 0}.
            </p>
            {result.error && <p className="mt-2 text-sm font-semibold text-red-800">{result.error}</p>}
            <div className="mt-4 space-y-2">
              {(result.results || []).map((item) => (
                <div key={`${item.group}-${item.contractId || item.number}`} className="rounded-lg border border-white/80 bg-white px-4 py-3 text-sm">
                  <p className="font-black">PO {item.number} — {item.group}</p>
                  <p className="mt-1 text-xs text-slate-600">
                    {item.status}{item.contractId ? ` · PO ID ${item.contractId}` : ""}
                    {item.createdLineItems !== undefined ? ` · ${item.createdLineItems} lines created` : ""}
                    {item.reusedLineItems ? ` · ${item.reusedLineItems} existing lines reused` : ""}
                  </p>
                  {item.error && <p className="mt-2 text-xs font-semibold text-red-700">{item.error}</p>}
                </div>
              ))}
            </div>
            {result.taskResult?.tasks?.length ? (
              <div className="mt-4 rounded-xl border border-white/80 bg-white p-4">
                <p className="text-sm font-black text-slate-900">Change-order follow-up tasks</p>
                <div className="mt-2 space-y-2">
                  {result.taskResult.tasks.map((task) => (
                    <div key={task.taskId} className="text-sm text-slate-700">
                      <span className="font-bold">{task.title}</span>
                      <span className="text-xs text-slate-500">
                        {` · Task ${task.taskId} · ${task.created ? "created" : task.updated ? "updated" : "already existed"} · ${task.notified ? "notification sent" : "notification pending"}`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {result.tasksQueued && !result.taskResult && (
              <p className="mt-3 text-sm font-semibold text-emerald-800">
                The follow-up tasks were queued and will be created and sent in the background.
              </p>
            )}
            {result.taskError && (
              <p className="mt-3 text-sm font-semibold text-red-800">Task error: {result.taskError}</p>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
