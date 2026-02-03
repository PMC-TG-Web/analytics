"use client";
import React, { useEffect, useState } from "react";

type KPIEntry = {
  id: string;
  year: string;
  month: number;
  monthName: string;
  scheduledSales?: number;
  bidSubmittedSales?: number;
  scheduledHours?: number;
  bidSubmittedHours?: number;
  cost?: number;
  updatedAt: string;
};

const monthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

export default function KPIManagementPage() {
  const [kpis, setKpis] = useState<KPIEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState<string>(new Date().getFullYear().toString());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    estimates: "",
    scheduledSales: "",
    bidSubmittedSales: "",
    subs: "",
    scheduledHours: "",
    bidSubmittedHours: "",
    grossProfit: "",
    cost: "",
    leadtimes: "",
  });

  // Load KPIs for selected year
  useEffect(() => {
    fetchKPIs(selectedYear);
  }, [selectedYear]);

  const fetchKPIs = async (year: string) => {
    try {
      setLoading(true);
      const res = await fetch(`/api/kpi?year=${year}`);
      const json = await res.json();
      setKpis(json.data || []);
    } catch (error) {
      console.error("Error loading KPIs:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (kpi: KPIEntry) => {
    setEditingId(kpi.id);
    setFormData({
      estimates: kpi.estimates?.toString() || "",
      scheduledSales: kpi.scheduledSales?.toString() || "",
      bidSubmittedSales: kpi.bidSubmittedSales?.toString() || "",
      subs: kpi.subs?.toString() || "",
      scheduledHours: kpi.scheduledHours?.toString() || "",
      bidSubmittedHours: kpi.bidSubmittedHours?.toString() || "",
      grossProfit: kpi.grossProfit?.toString() || "",
      cost: kpi.cost?.toString() || "",
      leadtimes: kpi.leadtimes?.toString() || "",
    });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSave = async (month: number) => {
    try {
      const payload = {
        year: selectedYear,
        month,
        monthName: monthNames[month - 1],
        estimates: formData.estimates ? parseFloat(formData.estimates) : undefined,
        scheduledSales: formData.scheduledSales ? parseFloat(formData.scheduledSales) : undefined,
        bidSubmittedSales: formData.bidSubmittedSales ? parseFloat(formData.bidSubmittedSales) : undefined,
        subs: formData.subs ? parseFloat(formData.subs) : undefined,
        scheduledHours: formData.scheduledHours ? parseFloat(formData.scheduledHours) : undefined,
        bidSubmittedHours: formData.bidSubmittedHours ? parseFloat(formData.bidSubmittedHours) : undefined,
        grossProfit: formData.grossProfit ? parseFloat(formData.grossProfit) : undefined,
        cost: formData.cost ? parseFloat(formData.cost) : undefined,
        leadtimes: formData.leadtimes ? parseFloat(formData.leadtimes) : undefined,
      };

      const res = await fetch("/api/kpi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setEditingId(null);
        setFormData({
          estimates: "",
          scheduledSales: "",
          bidSubmittedSales: "",
          subs: "",
          scheduledHours: "",
          bidSubmittedHours: "",
          grossProfit: "",
          cost: "",
          leadtimes: "",
        });
        fetchKPIs(selectedYear);
      }
    } catch (error) {
      console.error("Error saving KPI:", error);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this KPI entry?")) return;

    try {
      const res = await fetch("/api/kpi", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });

      if (res.ok) {
        fetchKPIs(selectedYear);
      }
    } catch (error) {
      console.error("Error deleting KPI:", error);
    }
  };

  const kpiMap = new Map(kpis.map(k => [k.month, k]));

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">KPI Management</h1>
          <div className="flex gap-2">
            <a href="/dashboard" className="px-4 py-2 bg-blue-900 text-white rounded-lg font-bold hover:bg-blue-800">
              Dashboard
            </a>
            <a href="/wip" className="px-4 py-2 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-500">
              WIP Report
            </a>
            <a href="/kpi" className="px-4 py-2 bg-orange-500 text-white rounded-lg font-bold hover:bg-orange-600">
              KPI Dashboard
            </a>
            <a href="/scheduling" className="px-4 py-2 bg-green-600 text-white rounded-lg font-bold hover:bg-green-500">
              Scheduling
            </a>
            <a href="/long-term-schedule" className="px-4 py-2 bg-purple-600 text-white rounded-lg font-bold hover:bg-purple-500">
              Long-Term Schedule
            </a>
          </div>
        </div>

        <div className="mb-8 flex gap-2 items-center">
          <label className="text-gray-700 font-medium">Year:</label>
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg"
          >
            {[2024, 2025, 2026, 2027].map(year => (
              <option key={year} value={year.toString()}>{year}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {monthNames.map((monthName, index) => {
              const month = index + 1;
              const kpi = kpiMap.get(month);
              const isEditing = editingId === `${selectedYear}-${String(month).padStart(2, "0")}`;

              return (
                <div key={month} className="bg-white rounded-lg shadow p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">{monthName}</h3>

                  {isEditing ? (
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Estimates
                        </label>
                        <input
                          type="number"
                          name="estimates"
                          value={formData.estimates}
                          onChange={handleInputChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          placeholder="0"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Sales ($)
                        </label>
                        <input
                          type="number"
                          name="scheduledSales"
                          value={formData.scheduledSales}
                          onChange={handleInputChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          placeholder="0"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Revenue ($)
                        </label>
                        <input
                          type="number"
                          name="bidSubmittedSales"
                          value={formData.bidSubmittedSales}
                          onChange={handleInputChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          placeholder="0"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Subs
                        </label>
                        <input
                          type="number"
                          name="subs"
                          value={formData.subs}
                          onChange={handleInputChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          placeholder="0"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Revenue Hours
                        </label>
                        <input
                          type="number"
                          name="scheduledHours"
                          value={formData.scheduledHours}
                          onChange={handleInputChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          placeholder="0"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Bid Submitted Hours
                        </label>
                        <input
                          type="number"
                          name="bidSubmittedHours"
                          value={formData.bidSubmittedHours}
                          onChange={handleInputChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          placeholder="0"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Gross Profit ($)
                        </label>
                        <input
                          type="number"
                          name="grossProfit"
                          value={formData.grossProfit}
                          onChange={handleInputChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          placeholder="0"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Profit ($)
                        </label>
                        <input
                          type="number"
                          name="cost"
                          value={formData.cost}
                          onChange={handleInputChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          placeholder="0"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Leadtimes
                        </label>
                        <input
                          type="number"
                          name="leadtimes"
                          value={formData.leadtimes}
                          onChange={handleInputChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          placeholder="0"
                        />
                      </div>

                      <div className="flex gap-2 pt-4">
                        <button
                          onClick={() => handleSave(month)}
                          className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 rounded-lg"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-900 font-medium py-2 rounded-lg"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2 text-sm">
                      {kpi ? (
                        <>
                          {kpi.estimates !== undefined && (
                            <div className="flex justify-between">
                              <span className="text-gray-600">Estimates:</span>
                              <span className="font-medium">{kpi.estimates.toLocaleString()}</span>
                            </div>
                          )}
                          {kpi.scheduledSales !== undefined && (
                            <div className="flex justify-between">
                              <span className="text-gray-600">Sales:</span>
                              <span className="font-medium">${kpi.scheduledSales.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                            </div>
                          )}
                          {kpi.bidSubmittedSales !== undefined && (
                            <div className="flex justify-between">
                              <span className="text-gray-600">Revenue:</span>
                              <span className="font-medium">${kpi.bidSubmittedSales.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                            </div>
                          )}
                          {kpi.subs !== undefined && (
                            <div className="flex justify-between">
                              <span className="text-gray-600">Subs:</span>
                              <span className="font-medium">{kpi.subs.toLocaleString()}</span>
                            </div>
                          )}
                          {kpi.scheduledHours !== undefined && (
                            <div className="flex justify-between">
                              <span className="text-gray-600">Revenue Hours:</span>
                              <span className="font-medium">{kpi.scheduledHours.toLocaleString()}</span>
                            </div>
                          )}
                          {kpi.bidSubmittedHours !== undefined && (
                            <div className="flex justify-between">
                              <span className="text-gray-600">Bid Submitted Hours:</span>
                              <span className="font-medium">{kpi.bidSubmittedHours.toLocaleString()}</span>
                            </div>
                          )}
                          {kpi.grossProfit !== undefined && (
                            <div className="flex justify-between">
                              <span className="text-gray-600">Gross Profit:</span>
                              <span className="font-medium">${kpi.grossProfit.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                            </div>
                          )}
                          {kpi.cost !== undefined && (
                            <div className="flex justify-between">
                              <span className="text-gray-600">Profit:</span>
                              <span className="font-medium">${kpi.cost.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                            </div>
                          )}
                          {kpi.leadtimes !== undefined && (
                            <div className="flex justify-between">
                              <span className="text-gray-600">Leadtimes:</span>
                              <span className="font-medium">{kpi.leadtimes.toLocaleString()}</span>
                            </div>
                          )}
                          <div className="flex gap-2 pt-4">
                            <button
                              onClick={() => handleEdit(kpi)}
                              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 rounded-lg text-sm"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDelete(kpi.id)}
                              className="flex-1 bg-red-600 hover:bg-red-700 text-white font-medium py-2 rounded-lg text-sm"
                            >
                              Delete
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="text-gray-500 italic">No data entered</p>
                          <button
                            onClick={() => handleEdit({ id: `${selectedYear}-${String(month).padStart(2, "0")}`, year: selectedYear, month, monthName, updatedAt: new Date().toISOString() })}
                            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 rounded-lg mt-4"
                          >
                            Add Data
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
