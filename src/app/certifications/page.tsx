"use client";

import { useEffect, useState, useMemo } from "react";
import { db } from "@/firebase";
import { getDocs, addDoc, deleteDoc, query, collection, orderBy, doc } from "@/firebase";

import Navigation from "@/components/Navigation";
import { Certification } from "@/types/certifications";


interface Employee {
  id: string;
  firstName: string;
  lastName: string;
}

export default function CertificationsPage() {
  return <CertificationsContent />;
}

function CertificationsContent() {
  const [certifications, setCertifications] = useState<Certification[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "expiring" | "expired">("all");
  const [notifying, setNotifying] = useState(false);
  const [notifyResult, setNotifyResult] = useState<{ success?: boolean; message?: string; count?: number } | null>(null);

  // Form State
  const [saving, setSaving] = useState(false);
  const [newCert, setNewCert] = useState({
    employeeId: "",
    type: "",
    issueDate: "",
    expirationDate: "",
    notes: "",
  });

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [certSnap, empSnap] = await Promise.all([
        getDocs(query(collection(db, "certifications"), orderBy("expirationDate", "asc"))),
        getDocs(query(collection(db, "employees"), orderBy("firstName", "asc")))
      ]);

      const certData = certSnap.docs.map((doc: any) => ({
        id: doc.id,
        ...doc.data()
      })) as Certification[];

      const empData = empSnap.docs.map((doc: any) => ({
        id: doc.id,
        firstName: doc.data().firstName,
        lastName: doc.data().lastName,
      })) as Employee[];

      setCertifications(certData);
      setEmployees(empData.filter((e: any) => e.firstName)); // Simple validation
    } catch (error) {
      console.error("Failed to load data:", error);
    } finally {
      setLoading(false);
    }
  }

  async function addCert() {
    if (!newCert.employeeId || !newCert.type || !newCert.expirationDate) {
      alert("Please select an employee, type, and expiration date.");
      return;
    }

    setSaving(true);
    try {
      const emp = employees.find(e => e.id === newCert.employeeId);
      const certToSave = {
        ...newCert,
        employeeName: emp ? `${emp.firstName} ${emp.lastName}` : "Unknown",
        createdAt: new Date().toISOString(),
      };

      const docRef = await addDoc(collection(db, "certifications"), certToSave);
      const createdCert = { id: docRef.id, ...certToSave };

      setCertifications([createdCert, ...certifications]);
      setNewCert({
        employeeId: "",
        type: "",
        issueDate: "",
        expirationDate: "",
        notes: "",
      });
    } catch (error) {
      console.error("Failed to add certification:", error);
      alert("Failed to save record");
    } finally {
      setSaving(false);
    }
  }

  async function deleteCert(id: string) {
    if (!confirm("Delete this certification record?")) return;
    try {
      await deleteDoc(doc(db, "certifications", id));
      setCertifications(certifications.filter(c => c.id !== id));
    } catch (error) {
      console.error("Delete failed:", error);
    }
  }

  async function runNotificationCheck() {
    if (notifying) return;
    setNotifying(true);
    setNotifyResult(null);
    try {
      const res = await fetch('/api/check-certifications');
      const data = await res.json();
      setNotifyResult(data);
      if (data.success) {
        // Show success, then clear
        setTimeout(() => setNotifyResult(null), 5000);
      }
    } catch (error) {
      console.error("Notification check failed:", error);
      setNotifyResult({ success: false, message: "Connection error" });
    } finally {
      setNotifying(false);
    }
  }

  const stats = useMemo(() => {
    const now = new Date();
    const thirtyDays = new Date();
    thirtyDays.setDate(now.getDate() + 30);
    const ninetyDays = new Date();
    ninetyDays.setDate(now.getDate() + 90);

    return {
      total: certifications.length,
      expired: certifications.filter(c => new Date(c.expirationDate) < now).length,
      expiring30: certifications.filter(c => {
        const d = new Date(c.expirationDate);
        return d >= now && d <= thirtyDays;
      }).length,
      expiring90: certifications.filter(c => {
        const d = new Date(c.expirationDate);
        return d >= now && d <= ninetyDays;
      }).length,
    };
  }, [certifications]);

  const filteredCerts = useMemo(() => {
    const now = new Date();
    const thirtyDays = new Date();
    thirtyDays.setDate(now.getDate() + 30);

    return certifications.filter(c => {
      // Status filter
      if (statusFilter === "expired" && new Date(c.expirationDate) >= now) return false;
      if (statusFilter === "expiring" && (new Date(c.expirationDate) < now || new Date(c.expirationDate) > thirtyDays)) return false;
      if (statusFilter === "active" && new Date(c.expirationDate) < now) return false;

      // Search filter
      if (searchTerm) {
        const s = searchTerm.toLowerCase();
        return (
          c.employeeName.toLowerCase().includes(s) ||
          c.type.toLowerCase().includes(s) ||
          (c.notes && c.notes.toLowerCase().includes(s))
        );
      }
      return true;
    });
  }, [certifications, statusFilter, searchTerm]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">Certification Management</h1>
          <div className="text-center py-12">Loading certifications...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8 text-gray-950 font-sans">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold text-gray-900 uppercase tracking-tighter">Certification Management</h1>
              <button 
                onClick={runNotificationCheck}
                disabled={notifying}
                title="Manually trigger email notifications for 30/60/90 day milestones"
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                  notifying 
                    ? "bg-gray-100 text-gray-400 cursor-not-allowed border-gray-200" 
                    : "bg-teal-50 text-teal-800 border border-teal-200 hover:bg-teal-100 hover:text-teal-900"
                }`}
              >
                {notifying ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Checking...
                  </span>
                ) : (
                  <>
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                    </svg>
                    Send Notifications
                  </>
                )}
              </button>
              {notifyResult && (
                <span className={`text-[10px] font-bold px-2 py-1 rounded border ${notifyResult.success ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"}`}>
                  {notifyResult.message || (notifyResult.success ? `Success: Sent ${notifyResult.count} alerts` : "Failed")}
                </span>
              )}
            </div>
            <p className="text-gray-600 mt-1 uppercase text-xs font-black tracking-widest italic">Compliance & Safety Tracking</p>
          </div>
          <Navigation currentPage="employees" />
        </div>

        {/* Form Grid */}
        <div className="bg-white border border-gray-200 p-6 rounded-2xl mb-8 shadow-sm">
          <h3 className="text-xs font-black uppercase tracking-widest text-teal-800 mb-4 flex items-center gap-2 italic">
            <span className="w-2 h-2 bg-teal-500 rounded-full animate-pulse"></span>
            Add New Entry
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className="md:col-span-1">
              <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">Employee</label>
              <select
                value={newCert.employeeId}
                onChange={(e) => setNewCert({ ...newCert, employeeId: e.target.value })}
                className="w-full px-3 py-2 border-2 border-gray-100 rounded-xl focus:ring-0 focus:border-teal-500 outline-none text-sm font-bold bg-gray-50"
              >
                <option value="">Select...</option>
                {employees.map((e: any) => (
                  <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>
                ))}
              </select>
            </div>
            <div className="md:col-span-1">
              <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">Type</label>
              <input
                type="text"
                placeholder="OSHA 30..."
                value={newCert.type}
                onChange={(e) => setNewCert({ ...newCert, type: e.target.value })}
                className="w-full px-3 py-2 border-2 border-gray-100 rounded-xl focus:ring-0 focus:border-teal-500 outline-none text-sm font-bold bg-gray-50"
              />
            </div>
            <div className="md:col-span-1">
              <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">Expiration</label>
              <input
                type="date"
                value={newCert.expirationDate}
                onChange={(e) => setNewCert({ ...newCert, expirationDate: e.target.value })}
                className="w-full px-3 py-2 border-2 border-gray-100 rounded-xl focus:ring-0 focus:border-teal-500 outline-none text-sm font-bold bg-gray-50"
              />
            </div>
            <div className="md:col-span-1">
              <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">Notes (Opt)</label>
              <input
                type="text"
                value={newCert.notes}
                onChange={(e) => setNewCert({ ...newCert, notes: e.target.value })}
                className="w-full px-3 py-2 border-2 border-gray-100 rounded-xl focus:ring-0 focus:border-teal-500 outline-none text-sm font-bold bg-gray-50"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={addCert}
                disabled={saving}
                className="w-full bg-teal-800 text-white font-black uppercase text-[11px] tracking-widest py-2.5 rounded-xl hover:bg-teal-900 transition-colors disabled:opacity-50"
              >
                {saving ? "SAVING..." : "SAVE CERT"}
              </button>
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white border border-gray-200 p-6 rounded-2xl shadow-sm">
            <div className="text-gray-500 text-[10px] font-black uppercase tracking-widest mb-1">Total</div>
            <div className="text-4xl font-black text-gray-900">{stats.total}</div>
          </div>
          <div className="bg-red-50 border border-red-100 p-6 rounded-2xl shadow-sm">
            <div className="text-red-800 text-[10px] font-black uppercase tracking-widest mb-1">Expired</div>
            <div className="text-4xl font-black text-red-600">{stats.expired}</div>
          </div>
          <div className="bg-orange-50 border border-orange-100 p-6 rounded-2xl shadow-sm">
            <div className="text-orange-800 text-[10px] font-black uppercase tracking-widest mb-1">30 Days</div>
            <div className="text-4xl font-black text-orange-600">{stats.expiring30}</div>
          </div>
          <div className="bg-teal-50 border border-teal-100 p-6 rounded-2xl shadow-sm">
            <div className="text-teal-800 text-[10px] font-black uppercase tracking-widest mb-1">90 Days</div>
            <div className="text-4xl font-black text-teal-600">{stats.expiring90}</div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white border border-gray-200 p-6 rounded-2xl mb-8 shadow-sm">
          <div className="flex flex-wrap gap-4 items-center justify-between">
            <input
              type="text"
              placeholder="Search employee or certification type..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="flex-1 min-w-[300px] bg-gray-50 border-2 border-gray-100 rounded-xl px-4 py-2 text-gray-900 focus:outline-none focus:border-teal-500 font-bold"
            />
            <div className="flex gap-2">
              {["all", "active", "expiring", "expired"].map((f) => (
                <button
                  key={f}
                  onClick={() => setStatusFilter(f as any)}
                  className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                    statusFilter === f ? "bg-teal-800 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-gray-500">Employee</th>
                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-gray-500">Certification Type</th>
                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-gray-500 text-center">Expiration Date</th>
                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-gray-500 text-center">Status</th>
                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-gray-500">Notes</th>
                <th className="px-6 py-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredCerts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-400 italic">No certifications found matching your filters</td>
                </tr>
              ) : (
                filteredCerts.map((cert: any) => {
                  const now = new Date();
                  const thirtyDays = new Date();
                  thirtyDays.setDate(now.getDate() + 30);
                  const exp = new Date(cert.expirationDate);
                  
                  let statusLabel = "ACTIVE";
                  let statusColor = "bg-green-100 text-green-800 border-green-200";
                  
                  if (exp < now) {
                    statusLabel = "EXPIRED";
                    statusColor = "bg-red-100 text-red-800 border-red-200";
                  } else if (exp <= thirtyDays) {
                    statusLabel = "EXPIRING SOON";
                    statusColor = "bg-orange-100 text-orange-800 border-orange-200";
                  }

                  return (
                    <tr key={cert.id} className="hover:bg-teal-50/30 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="text-sm font-black text-gray-900">{cert.employeeName}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm font-bold text-gray-700">{cert.type}</div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <div className="text-sm font-black text-gray-900">{cert.expirationDate}</div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className={`text-[9px] font-black px-2 py-1 rounded border ${statusColor}`}>
                          {statusLabel}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-xs text-gray-500">{cert.notes || "—"}</div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => deleteCert(cert.id)}
                          className="opacity-0 group-hover:opacity-100 text-red-300 hover:text-red-600 transition-all"
                          title="Delete record"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
