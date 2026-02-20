"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, doc, setDoc, deleteDoc, query, orderBy, addDoc } from "firebase/firestore";
import { db } from "@/firebase";
import ProtectedPage from "@/components/ProtectedPage";
import Navigation from "@/components/Navigation";
import { Holiday } from "@/types";

export default function HolidaysPage() {
  return (
    <ProtectedPage page="holidays">
      <HolidaysContent />
    </ProtectedPage>
  );
}

function HolidaysContent() {
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingHoliday, setEditingHoliday] = useState<Holiday | null>(null);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [importing, setImporting] = useState(false);

  // Form state
  const [formData, setFormData] = useState<Partial<Holiday>>({
    name: "",
    date: "",
    isPaid: true,
  });

  useEffect(() => {
    loadHolidays();
  }, []);

  async function loadHolidays() {
    try {
      const q = query(collection(db, "holidays"), orderBy("date", "asc"));
      const snapshot = await getDocs(q);
      const holidayData = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as Holiday[];
      setHolidays(holidayData);
    } catch (error) {
      console.error("Error loading holidays:", error);
    } finally {
      setLoading(false);
    }
  }

  const handleOpenModal = (holiday?: Holiday) => {
    if (holiday) {
      setEditingHoliday(holiday);
      setFormData({
        name: holiday.name,
        date: holiday.date,
        isPaid: holiday.isPaid ?? true,
      });
    } else {
      setEditingHoliday(null);
      setFormData({
        name: "",
        date: "",
        isPaid: true,
      });
    }
    setModalVisible(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.date) return;

    setSaving(true);
    try {
      if (editingHoliday?.id) {
        await setDoc(doc(db, "holidays", editingHoliday.id), formData);
      } else {
        await addDoc(collection(db, "holidays"), formData);
      }
      await loadHolidays();
      setModalVisible(false);
    } catch (error) {
      console.error("Error saving holiday:", error);
      alert("Failed to save holiday");
    } finally {
      setSaving(false);
    }
  };

  const handleSeed = async () => {
    if (!confirm("This will add standard 2026 holidays. Continue?")) return;
    setSeeding(true);
    try {
      const standardHolidays = [
        { name: "New Year's Day", date: "2026-01-01", isPaid: true },
        { name: "Martin Luther King Jr. Day", date: "2026-01-19", isPaid: true },
        { name: "Presidents' Day", date: "2026-02-16", isPaid: true },
        { name: "Good Friday", date: "2026-04-03", isPaid: true },
        { name: "Memorial Day", date: "2026-05-25", isPaid: true },
        { name: "Juneteenth", date: "2026-06-19", isPaid: true },
        { name: "Independence Day (Observed)", date: "2026-07-03", isPaid: true },
        { name: "Labor Day", date: "2026-09-07", isPaid: true },
        { name: "Veterans Day", date: "2026-11-11", isPaid: true },
        { name: "Thanksgiving Day", date: "2026-11-26", isPaid: true },
        { name: "Day after Thanksgiving", date: "2026-11-27", isPaid: true },
        { name: "Christmas Eve", date: "2026-12-24", isPaid: true },
        { name: "Christmas Day", date: "2026-12-25", isPaid: true },
        { name: "New Year's Eve", date: "2026-12-31", isPaid: true }
      ];

      for (const h of standardHolidays) {
        // Simple check to avoid duplicates by date
        const exists = holidays.some(existing => existing.date === h.date);
        if (!exists) {
          await addDoc(collection(db, "holidays"), h);
        }
      }
      await loadHolidays();
    } catch (error) {
      console.error("Error seeding holidays:", error);
      alert("Failed to seed holidays");
    } finally {
      setSeeding(false);
    }
  };

  const handleImportCSV = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        const lines = text.split('\n');
        // skip header if it exists
        const startIdx = lines[0].toLowerCase().includes('name') || lines[0].toLowerCase().includes('date') ? 1 : 0;
        
        let count = 0;
        for (let i = startIdx; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          
          const [name, date, isPaid] = line.split(',').map(s => s.trim().replace(/^"|"$/g, ''));
          if (name && date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
            const exists = holidays.some(h => h.date === date);
            if (!exists) {
              await addDoc(collection(db, "holidays"), {
                name,
                date,
                isPaid: isPaid?.toLowerCase() === 'true' || isPaid === '1' || isPaid?.toLowerCase() === 'paid'
              });
              count++;
            }
          }
        }
        alert(`Successfully imported ${count} holidays.`);
        await loadHolidays();
      } catch (error) {
        console.error("Import error:", error);
        alert("Error importing CSV. Ensure format is: Name,YYYY-MM-DD,true/false");
      } finally {
        setImporting(false);
        e.target.value = "";
      }
    };
    reader.readAsText(file);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this holiday?")) return;

    try {
      await deleteDoc(doc(db, "holidays", id));
      await loadHolidays();
    } catch (error) {
      console.error("Error deleting holiday:", error);
      alert("Failed to delete holiday");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-white p-4">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-4xl font-bold text-white uppercase tracking-normal">
              Holiday Schedule
            </h1>
            <p className="text-gray-400 text-sm mt-1">Manage company holidays and paid time off</p>
          </div>
          <div className="flex gap-3 items-center">
            <div className="text-xs text-gray-400 uppercase font-semibold text-right hidden lg:block mr-2 leading-tight">
              CSV Format:<br/>Name, YYYY-MM-DD, Paid(true/false)
            </div>
            <button
              onClick={() => handleOpenModal()}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-xs font-semibold uppercase transition-colors"
            >
              Add Holiday
            </button>
            <label className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded text-xs font-semibold uppercase transition-colors border border-slate-600 cursor-pointer text-center min-w-[100px]">
              {importing ? "Importing..." : "Import CSV"}
              <input 
                type="file" 
                accept=".csv" 
                onChange={handleImportCSV} 
                className="hidden" 
                disabled={importing}
              />
            </label>
            {holidays.length === 0 && !loading && (
              <button
                onClick={handleSeed}
                disabled={seeding}
                className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded text-xs font-semibold uppercase transition-colors border border-slate-600"
              >
                {seeding ? "Seeding..." : "Seed 2026"}
              </button>
            )}
            <Navigation currentPage="holidays" />
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {holidays.map((holiday) => (
              <div
                key={holiday.id}
                className="bg-slate-700/50 border border-slate-600 p-4 rounded-lg flex justify-between items-start group hover:border-blue-500 hover:bg-slate-700/80 transition-all"
              >
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-bold text-white">{holiday.name}</h3>
                    {holiday.isPaid && (
                        <span className="bg-green-500/20 text-green-200 text-xs px-2 py-1 rounded font-semibold uppercase">
                            Paid
                        </span>
                    )}
                  </div>
                  <p className="text-lg font-semibold text-white">{new Date(holiday.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
                  <p className="text-gray-400 text-xs mt-1 uppercase font-semibold">{holiday.date}</p>
                </div>
                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleOpenModal(holiday)}
                    className="text-gray-400 hover:text-white p-1"
                    title="Edit"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleDelete(holiday.id!)}
                    className="text-gray-600 hover:text-red-500 p-1"
                    title="Delete"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
            {holidays.length === 0 && (
              <div className="col-span-full py-12 text-center bg-slate-700/30 border border-dashed border-slate-600 rounded-lg">
                <p className="text-gray-400">No holidays scheduled yet.</p>
              </div>
            )}
          </div>
        )}

        {/* Modal */}
        {modalVisible && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-slate-700/50 border border-slate-600 p-6 rounded-lg w-full max-w-md">
              <h2 className="text-xl font-bold text-white mb-6">
                {editingHoliday ? "Edit" : "Add"} Holiday
              </h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase mb-2">Holiday Name</label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm text-white focus:border-blue-500 outline-none transition-colors"
                    placeholder="e.g. New Year's Day"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase mb-2">Date</label>
                  <input
                    type="date"
                    required
                    value={formData.date}
                    onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm text-white focus:border-blue-500 outline-none transition-colors [color-scheme:dark]"
                  />
                </div>
                <div className="flex items-center gap-3 py-2">
                  <input
                    type="checkbox"
                    id="isPaid"
                    checked={formData.isPaid}
                    onChange={(e) => setFormData({ ...formData, isPaid: e.target.checked })}
                    className="w-4 h-4 accent-blue-600"
                  />
                  <label htmlFor="isPaid" className="text-xs font-semibold text-gray-300 cursor-pointer uppercase">
                    Paid Holiday
                  </label>
                </div>
                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setModalVisible(false)}
                    className="flex-1 bg-slate-600 hover:bg-slate-700 text-white py-2 rounded text-xs font-semibold uppercase transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2 rounded text-xs font-semibold uppercase transition-colors"
                  >
                    {saving ? "Saving..." : editingHoliday ? "Update" : "Add"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
