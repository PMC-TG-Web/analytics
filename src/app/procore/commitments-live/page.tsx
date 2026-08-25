"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Navigation from "@/components/Navigation";

type CommitmentLineRow = {
  id: string;
  sourceType: string;
  companyId: string | null;
  procoreProjectId: string | null;
  projectName: string | null;
  customer: string | null;
  projectStatus: string | null;
  bidBoardStatus: string | null;
  vendorName: string | null;
  parentRecordId: string | null;
  parentProcoreId: string | null;
  parentNumber: string | null;
  parentTitle: string | null;
  parentStatus: string | null;
  parentValue: number | null;
  lineProcoreId: string | null;
  description: string | null;
  quantity: number | null;
  unitCost: number | null;
  totalAmount: number | null;
  uom: string | null;
  position: number | null;
  wbsCode: string | null;
  costCode: string | null;
  costType: string | null;
  syncedAt: string | null;
};

type CommitmentsApiResponse = {
  success?: boolean;
  error?: string;
  details?: string;
  data?: CommitmentLineRow[];
  total?: number;
};

type CommitmentGroup = {
  key: string;
  sourceType: string;
  projectStatus: string | null;
  bidBoardStatus: string | null;
  projectName: string | null;
  customer: string | null;
  procoreProjectId: string | null;
  vendorName: string | null;
  parentNumber: string | null;
  parentTitle: string | null;
  parentStatus: string | null;
  parentValue: number | null;
  syncedAt: string | null;
  totalAmount: number;
  totalQuantity: number;
  rows: CommitmentLineRow[];
};

type ProjectGroup = {
  key: string;
  projectStatus: string | null;
  bidBoardStatus: string | null;
  projectName: string | null;
  customer: string | null;
  procoreProjectId: string | null;
  totalAmount: number;
  totalQuantity: number;
  groups: CommitmentGroup[];
};

function buildProjectGroups(rows: CommitmentLineRow[]): ProjectGroup[] {
  const projectMap = new Map<string, { project: ProjectGroup; groupMap: Map<string, CommitmentGroup> }>();

  for (const row of rows) {
    const projectKey = [row.procoreProjectId || "", row.projectName || "", row.customer || ""].join("::");
    const titleKey = [
      row.parentTitle || "",
      row.parentNumber || "",
      row.sourceType || "",
      row.parentRecordId || row.parentProcoreId || row.id,
    ].join("::");

    let projectEntry = projectMap.get(projectKey);
    if (!projectEntry) {
      projectEntry = {
        project: {
          key: projectKey,
          projectStatus: row.projectStatus,
          bidBoardStatus: row.bidBoardStatus,
          projectName: row.projectName,
          customer: row.customer,
          procoreProjectId: row.procoreProjectId,
          totalAmount: 0,
          totalQuantity: 0,
          groups: [],
        },
        groupMap: new Map<string, CommitmentGroup>(),
      };
      projectMap.set(projectKey, projectEntry);
    }

    if (typeof row.totalAmount === "number") projectEntry.project.totalAmount += row.totalAmount;
    if (typeof row.quantity === "number") projectEntry.project.totalQuantity += row.quantity;

    const existing = projectEntry.groupMap.get(titleKey);
    if (existing) {
      existing.rows.push(row);
      if (typeof row.totalAmount === "number") existing.totalAmount += row.totalAmount;
      if (typeof row.quantity === "number") existing.totalQuantity += row.quantity;
      continue;
    }

    const group: CommitmentGroup = {
      key: `${projectKey}::${titleKey}`,
      sourceType: row.sourceType,
      projectStatus: row.projectStatus,
      bidBoardStatus: row.bidBoardStatus,
      projectName: row.projectName,
      customer: row.customer,
      procoreProjectId: row.procoreProjectId,
      vendorName: row.vendorName,
      parentNumber: row.parentNumber,
      parentTitle: row.parentTitle,
      parentStatus: row.parentStatus,
      parentValue: row.parentValue,
      syncedAt: row.syncedAt,
      totalAmount: typeof row.totalAmount === "number" ? row.totalAmount : 0,
      totalQuantity: typeof row.quantity === "number" ? row.quantity : 0,
      rows: [row],
    };

    projectEntry.groupMap.set(titleKey, group);
    projectEntry.project.groups.push(group);
  }

  return Array.from(projectMap.values()).map(({ project }) => project);
}

export default function CommitmentsLivePage() {
  const [rows, setRows] = useState<CommitmentLineRow[]>([]);
  const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>({});
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [companyId, setCompanyId] = useState(process.env.NEXT_PUBLIC_PROCORE_COMPANY_ID || "");
  const [projectId, setProjectId] = useState("");
  const [sourceType, setSourceType] = useState("");
  const [projectStatus, setProjectStatus] = useState("");
  const [bidBoardStatus, setBidBoardStatus] = useState("");
  const [parentStatus, setParentStatus] = useState("");
  const [vendor, setVendor] = useState("");
  const [search, setSearch] = useState("");
  const [total, setTotal] = useState(0);
  const [lastRefreshedAt, setLastRefreshedAt] = useState("");
  const pageSize = 10000;

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const url = new URL("/api/procore/commitments-live", window.location.origin);
      url.searchParams.set("page", "1");
      url.searchParams.set("pageSize", String(pageSize));
      if (companyId.trim()) url.searchParams.set("companyId", companyId.trim());
      if (projectId.trim()) url.searchParams.set("projectId", projectId.trim());
      if (sourceType.trim()) url.searchParams.set("sourceType", sourceType.trim());
      if (projectStatus.trim()) url.searchParams.set("projectStatus", projectStatus.trim());
      if (bidBoardStatus.trim()) url.searchParams.set("bidBoardStatus", bidBoardStatus.trim());
      if (parentStatus.trim()) url.searchParams.set("parentStatus", parentStatus.trim());
      if (vendor.trim()) url.searchParams.set("vendor", vendor.trim());
      if (search.trim()) url.searchParams.set("search", search.trim());
      url.searchParams.set("_ts", String(Date.now()));

      const res = await fetch(url.toString(), { cache: "no-store" });
      const payload = (await res.json().catch(() => ({}))) as CommitmentsApiResponse;

      if (!res.ok || payload.success === false) {
        throw new Error(payload.error || payload.details || `Request failed with ${res.status}`);
      }

      setRows(Array.isArray(payload.data) ? payload.data : []);
      setTotal(Number(payload.total || 0));
      setLastRefreshedAt(new Date().toLocaleString());
    } catch (err) {
      setRows([]);
      setTotal(0);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [bidBoardStatus, companyId, parentStatus, projectId, projectStatus, search, sourceType, vendor]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const totals = useMemo(() => {
    let totalAmount = 0;
    let totalQuantity = 0;
    for (const row of rows) {
      if (typeof row.totalAmount === "number") totalAmount += row.totalAmount;
      if (typeof row.quantity === "number") totalQuantity += row.quantity;
    }
    return { totalAmount, totalQuantity };
  }, [rows]);

  const projectGroups = useMemo(() => buildProjectGroups(rows), [rows]);

  function toggleProject(key: string) {
    setCollapsedProjects((prev) => ({
      ...prev,
      [key]: !(prev[key] ?? true),
    }));
  }

  function toggleGroup(key: string) {
    setCollapsedGroups((prev) => ({
      ...prev,
      [key]: !(prev[key] ?? true),
    }));
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <Navigation />

      <div className="flex h-[calc(100vh-48px)] flex-col w-full px-3 py-8 space-y-5 xl:px-4 2xl:px-6">
        <section className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-black uppercase tracking-widest text-gray-800">Procore Commitment Lines</h1>
              <p className="mt-1 text-xs font-semibold text-gray-500">
                Row-level purchase order and commitment change order lines.
              </p>
              <p className="mt-1 text-xs font-semibold text-gray-500">
                {rows.length.toLocaleString()} rows on page, {total.toLocaleString()} total
              </p>
              {!!lastRefreshedAt && (
                <p className="mt-1 text-[11px] font-semibold text-gray-500">Last refreshed: {lastRefreshedAt}</p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/procore/commitments-live/maker"
                className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-black uppercase tracking-wider text-white hover:bg-emerald-800"
              >
                Commitment Maker
              </Link>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                <p className="font-black uppercase tracking-wider text-slate-500">Line Amount</p>
                <p className="mt-1 font-semibold text-slate-800">{formatCurrency(totals.totalAmount)}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                <p className="font-black uppercase tracking-wider text-slate-500">Line Qty</p>
                <p className="mt-1 font-semibold text-slate-800">{formatNumber(totals.totalQuantity)}</p>
              </div>
              <button
                onClick={() => void loadRows()}
                className="rounded-lg bg-indigo-700 px-4 py-2 text-xs font-black uppercase tracking-wider text-white hover:bg-indigo-800"
              >
                Refresh
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-8">
            <input
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              placeholder="Company ID"
              className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold"
            />
            <input
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              placeholder="Procore Project ID"
              className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold"
            />
            <select
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold"
            >
              <option value="">All sources</option>
              <option value="purchase_order_line">Purchase Order Lines</option>
              <option value="commitment_change_order_line">Commitment CO Lines</option>
            </select>
            <input
              value={projectStatus}
              onChange={(e) => setProjectStatus(e.target.value)}
              placeholder="Project status"
              className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold"
            />
            <input
              value={bidBoardStatus}
              onChange={(e) => setBidBoardStatus(e.target.value)}
              placeholder="Bid board status"
              className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold"
            />
            <input
              value={parentStatus}
              onChange={(e) => setParentStatus(e.target.value)}
              placeholder="Commitment status"
              className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold"
            />
            <input
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              placeholder="Vendor"
              className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search description, contract, code..."
              className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold"
            />
            <button
              onClick={() => {
                setProjectId("");
                setSourceType("");
                setProjectStatus("");
                setBidBoardStatus("");
                setParentStatus("");
                setVendor("");
                setSearch("");
              }}
              className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-black uppercase tracking-wider hover:bg-gray-50"
            >
              Clear Filters
            </button>
          </div>

          {!!error && <p className="mt-3 text-xs font-semibold text-red-700">{error}</p>}
        </section>

        <section className="min-h-0 flex-1 overflow-auto rounded-2xl border border-gray-200 bg-white p-4">
          <table className="min-w-[2200px] text-xs">
            <thead>
              <tr className="sticky top-0 z-10 border-b border-gray-200 bg-white text-left uppercase tracking-wider text-gray-500">
                <th className="py-2 pr-3">Toggle</th>
                <th className="py-2 pr-3">Source</th>
                <th className="py-2 pr-3">Project Status</th>
                <th className="py-2 pr-3">Bid Board Status</th>
                <th className="py-2 pr-3">Project</th>
                <th className="py-2 pr-3">Customer</th>
                <th className="py-2 pr-3">Procore Project</th>
                <th className="py-2 pr-3">Vendor</th>
                <th className="py-2 pr-3">Commitment Status</th>
                <th className="py-2 pr-3">Number</th>
                <th className="py-2 pr-3">Title</th>
                <th className="py-2 pr-3 text-right">Parent Value</th>
                <th className="py-2 pr-3 text-right">Line Pos</th>
                <th className="py-2 pr-3">Line ID</th>
                <th className="py-2 pr-3">Description</th>
                <th className="py-2 pr-3">WBS</th>
                <th className="py-2 pr-3">Cost Code</th>
                <th className="py-2 pr-3">Cost Type</th>
                <th className="py-2 pr-3">UOM</th>
                <th className="py-2 pr-3 text-right">Qty</th>
                <th className="py-2 pr-3 text-right">Unit Cost</th>
                <th className="py-2 pr-3 text-right">Line Amount</th>
                <th className="py-2 pr-3">Synced</th>
              </tr>
            </thead>
            <tbody>
              {!loading && projectGroups.length === 0 && (
                <tr>
                  <td className="py-4 text-gray-500" colSpan={23}>
                    No commitment rows found.
                  </td>
                </tr>
              )}

              {projectGroups.map((project) => {
                const projectCollapsed = collapsedProjects[project.key] ?? true;

                return (
                  <Fragment key={project.key}>
                    <tr className="border-b-2 border-slate-300 bg-slate-200 align-top text-slate-950">
                      <td className="py-2 pr-3 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => toggleProject(project.key)}
                          className="rounded border border-slate-300 bg-white px-2 py-1 font-black uppercase tracking-wider hover:bg-slate-50"
                        >
                          {projectCollapsed ? "Expand" : "Collapse"}
                        </button>
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap font-semibold">Project</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{project.projectStatus || "-"}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{project.bidBoardStatus || "-"}</td>
                      <td className="py-2 pr-3 font-semibold">{project.projectName || "-"}</td>
                      <td className="py-2 pr-3">{project.customer || "-"}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{project.procoreProjectId || "-"}</td>
                      <td className="py-2 pr-3 font-semibold">{project.groups.length.toLocaleString()} titles</td>
                      <td className="py-2 pr-3 whitespace-nowrap text-gray-500">-</td>
                      <td className="py-2 pr-3 whitespace-nowrap text-gray-500">-</td>
                      <td className="py-2 pr-3 text-gray-500">-</td>
                      <td className="py-2 pr-3 whitespace-nowrap text-right text-gray-500">-</td>
                      <td className="py-2 pr-3 whitespace-nowrap text-right">{formatNumber(project.groups.length)}</td>
                      <td className="py-2 pr-3 whitespace-nowrap text-gray-500">-</td>
                      <td className="py-2 pr-3 font-semibold">{sumGroupLines(project.groups).toLocaleString()} lines</td>
                      <td className="py-2 pr-3 whitespace-nowrap text-gray-500">-</td>
                      <td className="py-2 pr-3 whitespace-nowrap text-gray-500">-</td>
                      <td className="py-2 pr-3 whitespace-nowrap text-gray-500">-</td>
                      <td className="py-2 pr-3 whitespace-nowrap text-right">{formatNumber(project.totalQuantity)}</td>
                      <td className="py-2 pr-3 whitespace-nowrap text-right text-gray-500">-</td>
                      <td className="py-2 pr-3 whitespace-nowrap text-right font-semibold">{formatCurrencyMaybe(project.totalAmount)}</td>
                      <td className="py-2 pr-3 whitespace-nowrap text-gray-500">-</td>
                    </tr>
                    {!projectCollapsed &&
                      project.groups.map((group) => {
                        const collapsed = collapsedGroups[group.key] ?? true;

                        return (
                          <Fragment key={group.key}>
                            <tr className="border-b border-slate-200 bg-slate-100/70 align-top text-slate-900">
                              <td className="py-2 pr-3 whitespace-nowrap pl-6">
                                <button
                                  type="button"
                                  onClick={() => toggleGroup(group.key)}
                                  className="rounded border border-slate-300 bg-white px-2 py-1 font-black uppercase tracking-wider hover:bg-slate-50"
                                >
                                  {collapsed ? "Expand" : "Collapse"}
                                </button>
                              </td>
                              <td className="py-2 pr-3 whitespace-nowrap">{formatSourceType(group.sourceType)}</td>
                              <td className="py-2 pr-3 whitespace-nowrap">{group.projectStatus || "-"}</td>
                              <td className="py-2 pr-3 whitespace-nowrap">{group.bidBoardStatus || "-"}</td>
                              <td className="py-2 pr-3 font-semibold">{group.projectName || "-"}</td>
                              <td className="py-2 pr-3">{group.customer || "-"}</td>
                              <td className="py-2 pr-3 whitespace-nowrap">{group.procoreProjectId || "-"}</td>
                              <td className="py-2 pr-3">{group.vendorName || "-"}</td>
                              <td className="py-2 pr-3 whitespace-nowrap">{group.parentStatus || "-"}</td>
                              <td className="py-2 pr-3 whitespace-nowrap font-semibold">{group.parentNumber || "-"}</td>
                              <td className="py-2 pr-3 font-semibold">{group.parentTitle || "Untitled Additional"}</td>
                              <td className="py-2 pr-3 whitespace-nowrap text-right">{formatCurrencyMaybe(group.parentValue)}</td>
                              <td className="py-2 pr-3 whitespace-nowrap text-right">{formatNumber(group.rows.length)}</td>
                              <td className="py-2 pr-3 whitespace-nowrap text-gray-500">-</td>
                              <td className="py-2 pr-3 font-semibold">{group.rows.length.toLocaleString()} lines</td>
                              <td className="py-2 pr-3 whitespace-nowrap text-gray-500">-</td>
                              <td className="py-2 pr-3 whitespace-nowrap text-gray-500">-</td>
                              <td className="py-2 pr-3 whitespace-nowrap text-gray-500">-</td>
                              <td className="py-2 pr-3 whitespace-nowrap text-right">{formatNumber(group.totalQuantity)}</td>
                              <td className="py-2 pr-3 whitespace-nowrap text-right text-gray-500">-</td>
                              <td className="py-2 pr-3 whitespace-nowrap text-right font-semibold">{formatCurrencyMaybe(group.totalAmount)}</td>
                              <td className="py-2 pr-3 whitespace-nowrap">{formatDateTime(group.syncedAt)}</td>
                            </tr>
                            {!collapsed &&
                              group.rows.map((row) => (
                                <tr key={row.id} className="border-b border-gray-100 align-top text-gray-800">
                                  <td className="py-2 pr-3 whitespace-nowrap pl-10 text-gray-400">.</td>
                                  <td className="py-2 pr-3 whitespace-nowrap">{formatSourceType(row.sourceType)}</td>
                                  <td className="py-2 pr-3 whitespace-nowrap">{row.projectStatus || "-"}</td>
                                  <td className="py-2 pr-3 whitespace-nowrap">{row.bidBoardStatus || "-"}</td>
                                  <td className="py-2 pr-3 font-semibold">{row.projectName || "-"}</td>
                                  <td className="py-2 pr-3">{row.customer || "-"}</td>
                                  <td className="py-2 pr-3 whitespace-nowrap">{row.procoreProjectId || "-"}</td>
                                  <td className="py-2 pr-3">{row.vendorName || "-"}</td>
                                  <td className="py-2 pr-3 whitespace-nowrap">{row.parentStatus || "-"}</td>
                                  <td className="py-2 pr-3 whitespace-nowrap">{row.parentNumber || "-"}</td>
                                  <td className="py-2 pr-3">{row.parentTitle || "-"}</td>
                                  <td className="py-2 pr-3 whitespace-nowrap text-right">{formatCurrencyMaybe(row.parentValue)}</td>
                                  <td className="py-2 pr-3 whitespace-nowrap text-right">{formatNumber(row.position)}</td>
                                  <td className="py-2 pr-3 whitespace-nowrap">{row.lineProcoreId || row.id}</td>
                                  <td className="py-2 pr-3">{row.description || "-"}</td>
                                  <td className="py-2 pr-3 whitespace-nowrap">{row.wbsCode || "-"}</td>
                                  <td className="py-2 pr-3 whitespace-nowrap">{row.costCode || "-"}</td>
                                  <td className="py-2 pr-3 whitespace-nowrap">{row.costType || "-"}</td>
                                  <td className="py-2 pr-3 whitespace-nowrap">{row.uom || "-"}</td>
                                  <td className="py-2 pr-3 whitespace-nowrap text-right">{formatNumber(row.quantity)}</td>
                                  <td className="py-2 pr-3 whitespace-nowrap text-right">{formatCurrencyMaybe(row.unitCost)}</td>
                                  <td className="py-2 pr-3 whitespace-nowrap text-right">{formatCurrencyMaybe(row.totalAmount)}</td>
                                  <td className="py-2 pr-3 whitespace-nowrap">{formatDateTime(row.syncedAt)}</td>
                                </tr>
                              ))}
                          </Fragment>
                        );
                      })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

function formatSourceType(value: string | null | undefined) {
  if (value === "purchase_order_line") return "PO Line";
  if (value === "commitment_change_order_line") return "CO Line";
  return value || "-";
}

function formatCurrency(value: number) {
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatCurrencyMaybe(value: number | null | undefined) {
  return typeof value === "number" ? formatCurrency(value) : "-";
}

function formatNumber(value: number | null | undefined) {
  return typeof value === "number" ? value.toLocaleString() : "-";
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function sumGroupLines(groups: CommitmentGroup[]) {
  return groups.reduce((sum, group) => sum + group.rows.length, 0);
}
