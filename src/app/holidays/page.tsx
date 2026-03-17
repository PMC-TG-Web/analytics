"use client";

import { useEffect, useState } from "react";

import { Holiday } from "@/types";

const PMC_2026_HOLIDAYS: Holiday[] = [
  {
    name: "GOOD FRIDAY",
    date: "2026-04-03",
    isPaid: true,
    description: "First Year: CLOSED / PAID HOLIDAY. After One (1) Year: CLOSED ++",
  },
  {
    name: "EASTER MONDAY",
    date: "2026-04-06",
    isPaid: false,
    description: "First Year: N/A. After One (1) Year: OPTIONAL **",
  },
  {
    name: "ASCENSION DAY",
    date: "2026-05-14",
    isPaid: false,
    description: "First Year: N/A. After One (1) Year: OPTIONAL **",
  },
  {
    name: "PENTECOST",
    date: "2026-05-25",
    isPaid: false,
    description: "First Year: N/A. After One (1) Year: OPTIONAL **",
  },
  {
    name: "MEMORIAL DAY",
    date: "2026-05-25",
    isPaid: true,
    description: "First Year: PAID HOLIDAY. After One (1) Year: OPTIONAL **",
  },
  {
    name: "INDEPENDENCE DAY",
    date: "2026-07-03",
    isPaid: true,
    description: "First Year: PAID HOLIDAY. After One (1) Year: OPTIONAL **",
  },
  {
    name: "LABOR DAY",
    date: "2026-09-07",
    isPaid: true,
    description: "First Year: PAID HOLIDAY. After One (1) Year: OPTIONAL **",
  },
  {
    name: "AMISH HOLIDAY",
    date: "2026-10-11",
    isPaid: false,
    description: "First Year: N/A. After One (1) Year: SUNDAY - N/A",
  },
  {
    name: "THANKSGIVING",
    date: "2026-11-26",
    isPaid: true,
    description: "First Year: CLOSED / PAID HOLIDAY. After One (1) Year: CLOSED ++",
  },
  {
    name: "CHRISTMAS",
    date: "2026-12-25",
    isPaid: true,
    description: "First Year: CLOSED / PAID HOLIDAY. After One (1) Year: CLOSED ++",
  },
  {
    name: "2ND CHRISTMAS",
    date: "2026-12-26",
    isPaid: false,
    description: "First Year: N/A. After One (1) Year: SATURDAY - N/A",
  },
  {
    name: "NEW YEARS",
    date: "2027-01-01",
    isPaid: true,
    description: "First Year: CLOSED / PAID HOLIDAY. After One (1) Year: CLOSED ++",
  },
];

function toIsoDate(dateStr: string): string | null {
  const trimmed = dateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  const parts = trimmed.split('/').map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) return null;
  const [month, day, year] = parts;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export default function HolidaysPage() {
  return <HolidaysContent />;
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
    description: "",
  });

  useEffect(() => {
    loadHolidays();
  }, []);

  async function loadHolidays() {
    try {
      const response = await fetch('/api/holidays');
      const result = await response.json();
      if (result.success) {
        setHolidays(result.data || []);
      } else {
        console.error("Error loading holidays:", result.error);
      }
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
        description: holiday.description || "",
      });
    } else {
      setEditingHoliday(null);
      setFormData({
        name: "",
        date: "",
        isPaid: true,
        description: "",
      });
    }
    setModalVisible(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.date) return;

    setSaving(true);
    try {
      const method = editingHoliday?.id ? 'PUT' : 'POST';
      const body = editingHoliday?.id 
        ? { id: editingHoliday.id, ...formData }
        : formData;
      
      const response = await fetch('/api/holidays', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      
      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || 'Failed to save holiday');
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
    if (!confirm("This will add the PMC holiday calendar. Continue?")) return;
    setSeeding(true);
    try {
      // Filter out holidays that already exist
      const newHolidays = PMC_2026_HOLIDAYS.filter(
        h => !holidays.some(existing => existing.date === h.date && existing.name === h.name)
      );
      
      if (newHolidays.length > 0) {
        const response = await fetch('/api/holidays', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newHolidays),
        });
        
        const result = await response.json();
        if (!result.success) {
          throw new Error(result.error || 'Failed to seed holidays');
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
        const firstLine = (lines[0] || '').toLowerCase();
        const startIdx = firstLine.includes('name') || firstLine.includes('holiday') || firstLine.includes('date') ? 1 : 0;
        
        let count = 0;
        const newHolidaysToImport: Holiday[] = [];
        for (let i = startIdx; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          const columns = line.match(/("[^"]*(?:""[^"]*)*"|[^,]+)/g)?.map((s) =>
            s.trim().replace(/^"|"$/g, '').replace(/""/g, '"')
          ) || [];

          const [name, rawDate, firstYear, afterOneYear] = columns;
          const date = rawDate ? toIsoDate(rawDate) : null;

          if (name && date) {
            const descriptionParts = [
              firstYear ? `First Year: ${firstYear}` : null,
              afterOneYear ? `After One (1) Year: ${afterOneYear}` : null,
            ].filter(Boolean);

            const normalizedName = name.trim();
            const exists = holidays.some(h => h.date === date && h.name === normalizedName);
            if (!exists) {
              newHolidaysToImport.push({
                name: normalizedName,
                date,
                isPaid: /paid holiday|closed/i.test(`${firstYear || ''} ${afterOneYear || ''}`),
                description: descriptionParts.join('. '),
              });
              count++;
            }
          }
        }
        
        if (newHolidaysToImport.length > 0) {
          const response = await fetch('/api/holidays', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newHolidaysToImport),
          });
          
          const result = await response.json();
          if (!result.success) {
            throw new Error(result.error || 'Failed to import holidays');
          }
        }
        
        alert(`Successfully imported ${count} holidays.`);
        await loadHolidays();
      } catch (error) {
        console.error("Import error:", error);
        alert("Error importing CSV. Ensure the file includes Holiday/Name and Date columns.");
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
      const response = await fetch(`/api/holidays?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      
      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || 'Failed to delete holiday');
      }
      
      await loadHolidays();
    } catch (error) {
      console.error("Error deleting holiday:", error);
      alert("Failed to delete holiday");
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8 text-gray-950 font-sans">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 uppercase tracking-tighter">
              Holiday Schedule
            </h1>
            <p className="text-gray-600 mt-1 uppercase text-xs font-black tracking-widest italic">Manage company holidays and paid time off</p>
          </div>
          <div className="flex gap-3 items-center">
            <div className="text-xs text-gray-500 uppercase font-black tracking-widest text-right hidden lg:block mr-2 leading-tight">
              CSV Format:<br/>Name, YYYY-MM-DD, Paid(true/false)
            </div>
            <button
              onClick={() => handleOpenModal()}
              className="bg-teal-50 text-teal-800 border border-teal-200 hover:bg-teal-100 hover:text-teal-900 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all"
            >
              Add Holiday
            </button>
            <label className="bg-gray-100 text-gray-700 border border-gray-200 hover:bg-gray-200 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors cursor-pointer text-center min-w-fit">
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
                className="bg-gray-100 text-gray-700 border border-gray-200 hover:bg-gray-200 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors disabled:opacity-50"
              >
                {seeding ? "Seeding..." : "Seed 2026"}
              </button>
            )}
          </div>
        </div>

        <div className="mb-8 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-gray-900 shadow-sm">
          <h2 className="text-sm font-black uppercase tracking-widest text-amber-900 mb-3">
            PMC Holiday Policy Notes
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-sm leading-relaxed">
            <div>
              <p><span className="font-black">Optional (**):</span> You need to ask for the day off. Otherwise, the company will assume you are working that day.</p>
              <p className="mt-2"><span className="font-black">Closed (++):</span> You can choose whether to take the day as paid or unpaid where noted.</p>
            </div>
            <div>
              <p>During your first year, after 90 days of active full-time employment, you are paid for the holidays listed in the First Year column whether you work or not, until your first-year anniversary.</p>
              <p className="mt-2">Thereafter, each April 1st you receive 12 days at 9 hours per day to use for paid holidays, vacation, optional holidays, or another day of your choosing, with one additional day per year of employment up to 15 vacation days.</p>
              <p className="mt-2 font-black uppercase tracking-wide text-[11px] text-amber-900">Fiscal Year: April 1st to March 31st</p>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-teal-500"></div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {holidays.map((holiday) => (
              <div
                key={holiday.id}
                className="bg-white border border-gray-200 p-6 rounded-2xl flex justify-between items-start group hover:border-teal-300 hover:shadow-md transition-all shadow-sm"
              >
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="font-bold text-gray-900">{holiday.name}</h3>
                    {holiday.isPaid && (
                        <span className="bg-teal-50 text-teal-700 text-[10px] px-2 py-1 rounded font-black uppercase tracking-widest border border-teal-200">
                            Paid
                        </span>
                    )}
                  </div>
                  <p className="text-lg font-semibold text-gray-900">{new Date(holiday.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
                  <p className="text-gray-500 text-xs mt-1 uppercase font-black tracking-widest">{holiday.date}</p>
                  {holiday.description && (
                    <p className="text-gray-600 text-xs mt-3 max-w-xs leading-relaxed">{holiday.description}</p>
                  )}
                </div>
                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleOpenModal(holiday)}
                    className="text-gray-400 hover:text-teal-600 p-1"
                    title="Edit"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleDelete(holiday.id!)}
                    className="text-gray-400 hover:text-red-500 p-1"
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
              <div className="col-span-full py-12 text-center bg-gray-50 border border-dashed border-gray-200 rounded-lg">
                <p className="text-gray-500">No holidays scheduled yet.</p>
              </div>
            )}
          </div>
        )}

        {/* Modal */}
        {modalVisible && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white border border-gray-200 p-6 rounded-2xl w-full max-w-md shadow-xl">
              <h2 className="text-lg font-black text-gray-900 mb-6 uppercase tracking-tight">
                {editingHoliday ? "Edit" : "Add"} Holiday
              </h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-500 mb-2">Holiday Name</label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:border-teal-300 focus:ring-1 focus:ring-teal-200 outline-none transition-colors"
                    placeholder="e.g. New Year's Day"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-500 mb-2">Date</label>
                  <input
                    type="date"
                    required
                    value={formData.date}
                    onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:border-teal-300 focus:ring-1 focus:ring-teal-200 outline-none transition-colors"
                  />
                </div>
                <div className="flex items-center gap-3 py-2">
                  <input
                    type="checkbox"
                    id="isPaid"
                    checked={formData.isPaid}
                    onChange={(e) => setFormData({ ...formData, isPaid: e.target.checked })}
                    className="w-4 h-4 accent-teal-600 rounded"
                  />
                  <label htmlFor="isPaid" className="text-xs font-black text-gray-700 cursor-pointer uppercase tracking-wider">
                    Paid Holiday
                  </label>
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-500 mb-2">Description</label>
                  <textarea
                    value={formData.description || ""}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full min-h-24 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:border-teal-300 focus:ring-1 focus:ring-teal-200 outline-none transition-colors"
                    placeholder="Holiday policy or notes"
                  />
                </div>
                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setModalVisible(false)}
                    className="flex-1 bg-gray-100 text-gray-700 hover:bg-gray-200 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex-1 bg-teal-50 text-teal-800 border border-teal-200 hover:bg-teal-100 hover:text-teal-900 disabled:opacity-50 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors"
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
