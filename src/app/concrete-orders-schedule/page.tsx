"use client";

import { useEffect, useMemo, useState } from "react";

type ActiveScheduleEntry = {
  jobKey: string;
  customer?: string;
  projectNumber?: string;
  projectName?: string;
  source?: string | null;
};

type ConcreteRow = {
  jobKey: string;
  customer: string;
  projectNumber: string;
  projectName: string;
};

type ConcreteOrder = {
  id: string;
  jobKey: string;
  projectName: string;
  concreteCompany: string;
  date: string;
  time: string;
  totalYards: number;
};

function getCurrentWeekMonday(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const monday = new Date(today);
  const dayOfWeek = monday.getDay();
  const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  monday.setDate(monday.getDate() + daysToMonday);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatHeaderDate(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const ORDER_STORAGE_KEY = "concrete-orders-entries-v1";

export default function ConcreteOrdersSchedulePage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ConcreteRow[]>([]);
  const [orders, setOrders] = useState<ConcreteOrder[]>([]);
  const [savingOrder, setSavingOrder] = useState(false);
  const [activeProject, setActiveProject] = useState<ConcreteRow | null>(null);
  const [orderDate, setOrderDate] = useState("");
  const [orderTime, setOrderTime] = useState("");
  const [orderYards, setOrderYards] = useState("");
  const [orderCompany, setOrderCompany] = useState("");

  useEffect(() => {
    void loadSchedule();
    void loadOrders();
  }, []);

  async function loadOrders() {
    try {
      const response = await fetch("/api/concrete-orders", { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Failed to fetch concrete orders");
      }

      const json = await response.json();
      const data = Array.isArray(json?.data) ? json.data : [];
      setOrders(data);

      // One-time migration for historical local orders.
      const raw = localStorage.getItem(ORDER_STORAGE_KEY);
      if (!raw) return;

      const localOrders = JSON.parse(raw);
      if (!Array.isArray(localOrders) || localOrders.length === 0) return;

      for (const order of localOrders) {
        await fetch("/api/concrete-orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(order),
        });
      }

      localStorage.removeItem(ORDER_STORAGE_KEY);
      const refreshed = await fetch("/api/concrete-orders", { cache: "no-store" });
      const refreshedJson = await refreshed.json();
      setOrders(Array.isArray(refreshedJson?.data) ? refreshedJson.data : []);
    } catch (error) {
      console.error("Failed to load concrete orders:", error);
    }
  }

  async function loadSchedule() {
    try {
      setLoading(true);

      const start = getCurrentWeekMonday();
      const end = new Date(start);
      end.setDate(end.getDate() + 15 * 7 - 1);

      const startDate = formatDateKey(start);
      const endDate = formatDateKey(end);

      const res = await fetch(
        `/api/short-term-schedule?action=active-schedule&startDate=${startDate}&endDate=${endDate}`,
        { cache: "no-store" }
      );

      if (!res.ok) {
        throw new Error("Failed to load active schedule");
      }

      const json = await res.json();
      const allEntries: ActiveScheduleEntry[] = json?.data || [];

      const entries = allEntries.filter((entry) => {
        const source = (entry.source || "").toLowerCase();
        return source === "gantt" || source === "wip-page";
      });

      const rowMap = new Map<string, ConcreteRow>();

      entries.forEach((entry) => {
        if (!entry?.jobKey) return;

        if (!rowMap.has(entry.jobKey)) {
          rowMap.set(entry.jobKey, {
            jobKey: entry.jobKey,
            customer: entry.customer || "",
            projectNumber: entry.projectNumber || "",
            projectName: entry.projectName || entry.jobKey.split("~")[2] || "Project",
          });
        }
      });

      const projectRows = Array.from(rowMap.values()).sort((a, b) =>
        a.projectName.localeCompare(b.projectName)
      );

      setRows(projectRows);
    } catch (error) {
      console.error("Failed to load concrete orders schedule:", error);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  function openProjectModal(row: ConcreteRow) {
    setActiveProject(row);
    setOrderDate("");
    setOrderTime("");
    setOrderYards("");
    setOrderCompany("");
  }

  function closeProjectModal() {
    setActiveProject(null);
  }

  async function submitOrder() {
    if (!activeProject) return;
    if (!orderDate || !orderTime || !orderYards || !orderCompany) return;

    const parsedYards = Number(orderYards);
    if (!Number.isFinite(parsedYards) || parsedYards <= 0) return;

    try {
      setSavingOrder(true);
      const response = await fetch("/api/concrete-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobKey: activeProject.jobKey,
          projectName: activeProject.projectName,
          concreteCompany: orderCompany,
          date: orderDate,
          time: orderTime,
          totalYards: parsedYards,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save concrete order");
      }

      const json = await response.json();
      const saved = json?.data as ConcreteOrder | undefined;
      if (saved) {
        setOrders((prev) => [...prev, saved]);
      }

      closeProjectModal();
    } catch (error) {
      console.error("Failed to save concrete order:", error);
      alert("Unable to save concrete order. Please try again.");
    } finally {
      setSavingOrder(false);
    }
  }

  const activeProjectOrders = activeProject
    ? orders
        .filter((order) => order.jobKey === activeProject.jobKey)
        .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
    : [];

  const dateColumns = useMemo(() => {
    return Array.from(new Set(orders.map((order) => order.date))).sort((a, b) =>
      a.localeCompare(b)
    );
  }, [orders]);

  const ordersByProjectDate = useMemo(() => {
    const summary: Record<string, { count: number; totalYards: number }> = {};

    orders.forEach((order) => {
      const key = `${order.jobKey}__${order.date}`;
      const current = summary[key] || { count: 0, totalYards: 0 };
      summary[key] = {
        count: current.count + 1,
        totalYards: current.totalYards + Number(order.totalYards || 0),
      };
    });

    return summary;
  }, [orders]);

  const orderCountByProject = useMemo(() => {
    const counts: Record<string, number> = {};
    orders.forEach((order) => {
      counts[order.jobKey] = (counts[order.jobKey] || 0) + 1;
    });
    return counts;
  }, [orders]);

  return (
    <main className="min-h-screen bg-neutral-100 p-2 md:p-4 font-sans text-slate-900">
      <div className="w-full flex flex-col min-h-[calc(100vh-2rem)] bg-white shadow-2xl rounded-3xl overflow-hidden border border-gray-200 p-4 md:p-8">
        <div className="flex items-center justify-between gap-4 mb-3 pb-3 border-b border-gray-100">
          <h1 className="text-2xl md:text-3xl font-black tracking-tight text-gray-900 uppercase italic leading-none">
            Concrete Orders <span className="text-orange-600">Schedule</span>
          </h1>
        </div>

        {loading ? (
          <div className="bg-gray-50 rounded-3xl border-2 border-dashed border-gray-200 p-12 text-center">
            <p className="text-gray-400 font-black uppercase tracking-[0.2em]">Loading Concrete Orders...</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="bg-gray-50 rounded-3xl border-2 border-dashed border-gray-200 p-12 text-center">
            <p className="text-gray-400 font-black uppercase tracking-[0.2em]">No Scheduled Projects Found</p>
          </div>
        ) : (
          <div className="flex-1 bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
            {dateColumns.length === 0 && (
              <div className="px-5 py-3 bg-orange-50 border-b border-orange-100 text-xs font-black uppercase tracking-widest text-orange-700">
                No concrete order dates yet. Click a project and save an order to create date columns.
              </div>
            )}
            <div className="overflow-x-auto h-full lt-visible-scrollbar">
              <table className="w-full border-collapse">
                <thead className="sticky top-0 z-30">
                  <tr className="bg-stone-800">
                    <th className="sticky left-0 z-40 bg-stone-800 text-left py-5 px-5 text-sm font-black text-white uppercase tracking-[0.12em] italic border-r border-stone-700 min-w-[260px]">
                      Project
                    </th>
                    {dateColumns.map((dateKey) => (
                      <th
                        key={dateKey}
                        className="text-center py-4 px-3 text-sm font-black text-white border-r border-stone-700 min-w-[120px]"
                      >
                        <div className="text-xs text-orange-400 uppercase tracking-widest">Date</div>
                        <div className="text-xl italic tracking-tight text-white">{formatHeaderDate(dateKey)}</div>
                      </th>
                    ))}
                    <th className="text-center py-5 px-5 text-sm font-black text-white bg-stone-800 border-l border-stone-700 uppercase tracking-widest">
                      Orders
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => (
                    <tr
                      key={row.jobKey}
                      className={`border-b border-gray-50 ${idx % 2 === 0 ? "bg-white" : "bg-gray-50/50"}`}
                    >
                      <td className="sticky left-0 z-20 bg-inherit py-3 px-5 text-sm font-black text-gray-900 border-r border-gray-100">
                        <button
                          type="button"
                          onClick={() => openProjectModal(row)}
                          className="w-full text-left hover:text-orange-700 transition-colors"
                        >
                          <div className="truncate uppercase italic tracking-tight">{row.projectName}</div>
                          <div className="text-[10px] text-gray-500 font-bold uppercase tracking-wider truncate mt-1">
                            {row.customer} {row.projectNumber ? `| ${row.projectNumber}` : ""}
                          </div>
                        </button>
                      </td>
                      {dateColumns.map((dateKey) => {
                        const summary = ordersByProjectDate[`${row.jobKey}__${dateKey}`];
                        return (
                          <td
                            key={`${row.jobKey}-${dateKey}`}
                            className={`text-center py-3 px-2 text-xs border-r border-gray-100 font-black uppercase tracking-wider ${summary ? "bg-orange-50/40 text-orange-700" : "text-gray-300"}`}
                          >
                            {summary ? `${summary.totalYards.toFixed(1)} YD` : "-"}
                          </td>
                        );
                      })}
                      <td className="text-center py-3 px-4 text-sm font-black bg-stone-50 border-l border-gray-200 text-gray-900">
                        {orderCountByProject[row.jobKey] || 0}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {activeProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45" onClick={closeProjectModal}>
          <div
            className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-gray-200 p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="text-2xl font-black uppercase italic text-stone-900 tracking-tight">
              Concrete Order
            </h2>
            <p className="text-xs font-black uppercase tracking-widest text-gray-500 mt-2 mb-5">
              {activeProject.projectName}
            </p>

            <div className="grid grid-cols-1 gap-3 mb-4">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Concrete Company</span>
                <input
                  type="text"
                  value={orderCompany}
                  onChange={(event) => setOrderCompany(event.target.value)}
                  className="h-10 px-3 rounded-lg border border-gray-300 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-orange-500"
                  placeholder="e.g. Acme Ready Mix"
                />
              </label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Date</span>
                  <input
                    type="date"
                    value={orderDate}
                    onChange={(event) => setOrderDate(event.target.value)}
                    className="h-10 px-3 rounded-lg border border-gray-300 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Time</span>
                  <input
                    type="time"
                    value={orderTime}
                    onChange={(event) => setOrderTime(event.target.value)}
                    className="h-10 px-3 rounded-lg border border-gray-300 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Total Yards</span>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={orderYards}
                    onChange={(event) => setOrderYards(event.target.value)}
                    className="h-10 px-3 rounded-lg border border-gray-300 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-orange-500"
                    placeholder="0"
                  />
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 mb-4">
              <button
                type="button"
                onClick={closeProjectModal}
                className="h-10 px-4 rounded-lg border border-gray-300 text-gray-700 text-xs font-black uppercase tracking-widest hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitOrder}
                disabled={savingOrder}
                className="h-10 px-4 rounded-lg bg-orange-600 text-white text-xs font-black uppercase tracking-widest hover:bg-orange-700 disabled:opacity-60"
              >
                {savingOrder ? "Saving..." : "Save Order"}
              </button>
            </div>

            {activeProjectOrders.length > 0 && (
              <div className="border-t border-gray-200 pt-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-2">Saved Orders</p>
                <div className="max-h-40 overflow-y-auto space-y-2 pr-1">
                  {activeProjectOrders.map((order) => (
                    <div key={order.id} className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700">
                      <span className="font-black text-stone-800">{order.concreteCompany || "-"}</span>
                      <span className="mx-1 text-gray-300">|</span>
                      {order.date} at {order.time}
                      <span className="mx-1 text-gray-300">|</span>
                      {order.totalYards} yards
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
