"use client";

import { useEffect, useMemo, useState } from "react";

export type ConcreteOrderProjectRef = {
  jobKey: string;
  projectName: string;
  customer?: string;
  projectNumber?: string;
};

export type ConcreteOrder = {
  id: string;
  jobKey: string;
  projectName: string;
  concreteCompany: string;
  date: string;
  time: string;
  totalYards: number;
  concreteConfirmed?: boolean | null;
};

type ConcreteOrderModalProps = {
  isOpen: boolean;
  project: ConcreteOrderProjectRef | null;
  taskLabel?: string | null;
  initialDate?: string;
  initialTime?: string;
  initialYards?: number | null;
  initialCompany?: string;
  onClose: () => void;
  onSaved?: (order: ConcreteOrder) => void;
};

type EditingFields = {
  concreteCompany: string;
  date: string;
  time: string;
  totalYards: string;
};

export function ConcreteOrderModal({
  isOpen,
  project,
  taskLabel,
  initialDate = "",
  initialTime = "",
  initialYards = null,
  initialCompany = "",
  onClose,
  onSaved,
}: ConcreteOrderModalProps) {
  const [savingOrder, setSavingOrder] = useState(false);
  const [orders, setOrders] = useState<ConcreteOrder[]>([]);
  const [orderDate, setOrderDate] = useState("");
  const [orderTime, setOrderTime] = useState("");
  const [orderYards, setOrderYards] = useState("");
  const [orderCompany, setOrderCompany] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingFields, setEditingFields] = useState<EditingFields>({ concreteCompany: "", date: "", time: "", totalYards: "" });
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !project) return;

    setOrderDate(initialDate || "");
    setOrderTime(initialTime || "");
    setOrderYards(initialYards && initialYards > 0 ? String(initialYards) : "");
    setOrderCompany(initialCompany || "");
  }, [initialCompany, initialDate, initialTime, initialYards, isOpen, project]);

  useEffect(() => {
    if (!isOpen || !project?.jobKey) return;

    const loadOrders = async () => {
      try {
        const response = await fetch("/api/concrete-orders", { cache: "no-store" });
        if (!response.ok) return;
        const json = await response.json().catch(() => ({}));
        const allOrders = Array.isArray(json?.data) ? json.data : [];
        setOrders(allOrders.filter((order: ConcreteOrder) => order.jobKey === project.jobKey));
      } catch (error) {
        console.error("Failed to load concrete orders for modal:", error);
        setOrders([]);
      }
    };

    void loadOrders();
  }, [isOpen, project]);

  const sortedOrders = useMemo(() => {
    return [...orders].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  }, [orders]);

  if (!isOpen || !project) return null;

  function startEditing(order: ConcreteOrder) {
    setEditingId(order.id);
    setEditingFields({
      concreteCompany: order.concreteCompany,
      date: order.date,
      time: order.time,
      totalYards: String(order.totalYards),
    });
  }

  function cancelEditing() {
    setEditingId(null);
  }

  async function saveEdit(id: string) {
    const parsedYards = Number(editingFields.totalYards);
    if (!editingFields.concreteCompany || !editingFields.date || !editingFields.time || !Number.isFinite(parsedYards) || parsedYards <= 0) {
      alert("Concrete company, date, time, and total yards are required.");
      return;
    }

    try {
      setSavingEdit(true);
      const response = await fetch("/api/concrete-orders", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          concreteCompany: editingFields.concreteCompany,
          date: editingFields.date,
          time: editingFields.time,
          totalYards: parsedYards,
        }),
      });

      if (!response.ok) {
        const json = await response.json().catch(() => ({}));
        throw new Error(json?.error || `Failed to update concrete order (${response.status})`);
      }

      const json = await response.json().catch(() => ({}));
      const updated = json?.data as ConcreteOrder | undefined;
      if (updated) {
        setOrders((prev) => prev.map((o) => o.id === id ? updated : o));
      }
      setEditingId(null);
    } catch (error) {
      console.error("Failed to update concrete order:", error);
      alert("Unable to update concrete order. Please try again.");
    } finally {
      setSavingEdit(false);
    }
  }

  async function deleteOrder(id: string) {
    if (!confirm("Delete this concrete order?")) return;
    try {
      setDeletingId(id);
      const response = await fetch("/api/concrete-orders", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!response.ok) throw new Error("Failed to delete concrete order");
      setOrders((prev) => prev.filter((o) => o.id !== id));
      if (editingId === id) setEditingId(null);
    } catch (error) {
      console.error("Failed to delete concrete order:", error);
      alert("Unable to delete concrete order. Please try again.");
    } finally {
      setDeletingId(null);
    }
  }

  async function submitOrder() {
    if (!project) return;
    if (!orderDate || !orderTime || !orderYards || !orderCompany) {
      alert("Concrete company, date, time, and total yards are required.");
      return;
    }

    const parsedYards = Number(orderYards);
    if (!Number.isFinite(parsedYards) || parsedYards <= 0) {
      alert("Total yards must be greater than zero.");
      return;
    }

    try {
      setSavingOrder(true);
      const response = await fetch("/api/concrete-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobKey: project.jobKey,
          projectName: project.projectName,
          concreteCompany: orderCompany,
          date: orderDate,
          time: orderTime,
          totalYards: parsedYards,
        }),
      });

      if (!response.ok) {
        const json = await response.json().catch(() => ({}));
        throw new Error(json?.error || `Failed to save concrete order (${response.status})`);
      }

      const json = await response.json().catch(() => ({}));
      const saved = json?.data as ConcreteOrder | undefined;
      if (saved) {
        setOrders((prev) => [...prev, saved]);
        onSaved?.(saved);
      }

      onClose();
    } catch (error) {
      console.error("Failed to save concrete order:", error);
      alert("Unable to save concrete order. Please try again.");
    } finally {
      setSavingOrder(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-gray-200 p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-2xl font-black uppercase italic text-stone-900 tracking-tight">
          Concrete Order
        </h2>
        <p className="text-xs font-black uppercase tracking-widest text-gray-500 mt-2">
          {project.projectName}
        </p>
        {taskLabel ? (
          <p className="text-[11px] font-semibold text-orange-700 mt-1 mb-5">
            Task: {taskLabel}
          </p>
        ) : (
          <div className="mb-5" />
        )}

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
            onClick={onClose}
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

        {sortedOrders.length > 0 && (
          <div className="border-t border-gray-200 pt-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-2">Saved Orders</p>
            <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
              {sortedOrders.map((order) =>
                editingId === order.id ? (
                  <div key={order.id} className="rounded-lg bg-orange-50 border border-orange-300 px-3 py-3 space-y-2">
                    <div className="grid grid-cols-1 gap-2">
                      <input
                        type="text"
                        value={editingFields.concreteCompany}
                        onChange={(e) => setEditingFields((prev) => ({ ...prev, concreteCompany: e.target.value }))}
                        className="h-8 px-2 rounded border border-gray-300 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-orange-500"
                        placeholder="Concrete Company"
                      />
                      <div className="grid grid-cols-3 gap-2">
                        <input
                          type="date"
                          value={editingFields.date}
                          onChange={(e) => setEditingFields((prev) => ({ ...prev, date: e.target.value }))}
                          className="h-8 px-2 rounded border border-gray-300 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-orange-500"
                        />
                        <input
                          type="time"
                          value={editingFields.time}
                          onChange={(e) => setEditingFields((prev) => ({ ...prev, time: e.target.value }))}
                          className="h-8 px-2 rounded border border-gray-300 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-orange-500"
                        />
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          value={editingFields.totalYards}
                          onChange={(e) => setEditingFields((prev) => ({ ...prev, totalYards: e.target.value }))}
                          className="h-8 px-2 rounded border border-gray-300 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-orange-500"
                          placeholder="Yards"
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={cancelEditing}
                        className="h-7 px-3 rounded border border-gray-300 text-gray-600 text-[10px] font-black uppercase tracking-widest hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => saveEdit(order.id)}
                        disabled={savingEdit}
                        className="h-7 px-3 rounded bg-orange-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-orange-700 disabled:opacity-60"
                      >
                        {savingEdit ? "Saving…" : "Save"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div key={order.id} className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700">
                    <div className="flex-1 min-w-0 truncate">
                      <span className="font-black text-stone-800">{order.concreteCompany || "-"}</span>
                      <span className="mx-1 text-gray-300">|</span>
                      {order.date} at {order.time}
                      <span className="mx-1 text-gray-300">|</span>
                      {order.totalYards} yards
                      {typeof order.concreteConfirmed === "boolean" ? (
                        <span
                          className={`ml-2 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-black border align-middle ${
                            order.concreteConfirmed
                              ? "bg-green-100 text-green-700 border-green-200"
                              : "bg-red-100 text-red-700 border-red-200"
                          }`}
                        >
                          {order.concreteConfirmed ? "Confirmed" : "Not Confirmed"}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => startEditing(order)}
                        className="h-6 px-2 rounded border border-gray-300 text-[10px] font-black uppercase tracking-widest text-gray-600 hover:bg-white hover:border-orange-400 hover:text-orange-700"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteOrder(order.id)}
                        disabled={deletingId === order.id}
                        className="h-6 px-2 rounded border border-red-200 text-[10px] font-black uppercase tracking-widest text-red-500 hover:bg-red-50 hover:border-red-400 disabled:opacity-50"
                      >
                        {deletingId === order.id ? "…" : "Del"}
                      </button>
                    </div>
                  </div>
                )
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
