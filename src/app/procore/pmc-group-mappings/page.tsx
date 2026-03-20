"use client";

import { useEffect, useState } from "react";
import Navigation from "@/components/Navigation";

type MappingRow = {
  id: string;
  costItem: string;
  costType: string | null;
  pmcGroup: string;
  source: string | null;
  updatedAt: string;
};

export default function PmcGroupMappingsPage() {
  const [rows, setRows] = useState<MappingRow[]>([]);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(200);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jsonInput, setJsonInput] = useState(
    JSON.stringify(
      [
        {
          costItem: "Ready Mix Concrete For Foundations",
          costType: "Labor",
          pmcGroup: "FOUNDATION",
          source: "manual",
        },
      ],
      null,
      2
    )
  );
  const [replaceAll, setReplaceAll] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [csvMessage, setCsvMessage] = useState<string | null>(null);

  function parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  }

  function handleCsvUpload(e: React.ChangeEvent<HTMLInputElement>) {
    setCsvMessage(null);
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = reader.result as string;
        const lines = text.replace(/\r/g, "").split("\n").filter(Boolean);
        if (lines.length < 2) { setCsvMessage("CSV has no data rows."); return; }
        const headers = parseCSVLine(lines[0]).map((h) => h.replace(/^"|"$/g, "").toLowerCase());
        const colIdx = (name: string) => headers.findIndex((h) => h === name.toLowerCase());
        const ciIdx = colIdx("costitem");
        const ctIdx = colIdx("costtype");
        const pgIdx = colIdx("pmcgroup");
        const srcIdx = colIdx("source");
        if (ciIdx === -1 || pgIdx === -1) {
          setCsvMessage("CSV must have CostItem and PMCGroup columns.");
          return;
        }
        const parsed = lines.slice(1).map((line) => {
          const cols = parseCSVLine(line);
          return {
            costItem: cols[ciIdx] || "",
            costType: ctIdx !== -1 ? cols[ctIdx] || "" : "",
            pmcGroup: cols[pgIdx] || "",
            source: srcIdx !== -1 ? cols[srcIdx] || "csv" : "csv",
          };
        }).filter((r) => r.costItem && r.pmcGroup);
        setJsonInput(JSON.stringify(parsed, null, 2));
        setCsvMessage(`Parsed ${parsed.length} rows from CSV — review below then click Save Mappings.`);
      } catch {
        setCsvMessage("Failed to parse CSV.");
      }
    };
    reader.readAsText(file);
    // reset input so same file can be re-uploaded
    e.target.value = "";
  }

  async function loadMappings() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("query", query.trim());
      params.set("limit", String(limit));
      const res = await fetch(`/api/admin/pmc-group-mappings?${params.toString()}`);
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Failed to load mappings");
      setRows(Array.isArray(json.data) ? json.data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function saveMappings() {
    setSaveMessage(null);
    setError(null);
    setSaving(true);
    try {
      const parsed = JSON.parse(jsonInput);
      const body = {
        rows: Array.isArray(parsed) ? parsed : [parsed],
        replaceAll,
      };
      const res = await fetch("/api/admin/pmc-group-mappings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Failed to save mappings");
      setSaveMessage(`Upserted ${json.upserted} mapping rows.`);
      await loadMappings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    loadMappings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="min-h-screen bg-neutral-100 p-2 md:p-4 font-sans text-slate-900">
      <div className="w-full bg-white rounded-3xl border border-gray-200 shadow-2xl p-4 md:p-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-gray-100 pb-6 mb-6">
          <div>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight text-gray-900 uppercase italic leading-none">
              PMC Group <span className="text-red-700">Mappings</span>
            </h1>
            <p className="text-[10px] md:text-xs font-bold text-gray-500 uppercase tracking-[0.2em] mt-2">
              Database Mapping Admin
            </p>
          </div>
          <Navigation currentPage="procore" />
        </div>

        <section className="rounded-2xl border border-gray-200 bg-gray-50 p-5 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-600">
              Search
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
                placeholder="cost item / cost type / group"
              />
            </label>
            <label className="text-xs font-bold uppercase tracking-wider text-gray-600">
              Limit
              <input
                type="number"
                min={1}
                max={500}
                value={limit}
                onChange={(e) => setLimit(Math.min(500, Math.max(1, Number(e.target.value || "200"))))}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900"
              />
            </label>
            <div className="flex items-end">
              <button
                onClick={loadMappings}
                disabled={loading}
                className="px-4 py-2 rounded-xl bg-blue-700 text-white font-black text-xs uppercase tracking-widest hover:bg-blue-800 disabled:opacity-50"
              >
                {loading ? "Loading..." : "Refresh"}
              </button>
            </div>
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-3">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-600">
              Upload CSV
              <p className="text-[10px] font-medium text-gray-400 normal-case tracking-normal mt-0.5">
                Columns: CostItem, CostType, PMCGroup (+ optional Source)
              </p>
            </label>
            <label className="cursor-pointer px-4 py-2 rounded-xl bg-indigo-700 text-white font-black text-xs uppercase tracking-widest hover:bg-indigo-800 inline-block">
              Choose CSV
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleCsvUpload} />
            </label>
            {csvMessage && <span className="text-xs font-semibold text-indigo-700">{csvMessage}</span>}
          </div>

          <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 mb-2">
            JSON Rows to Upsert
          </label>
          <textarea
            value={jsonInput}
            onChange={(e) => setJsonInput(e.target.value)}
            className="w-full min-h-[220px] rounded-xl border border-gray-300 bg-white px-3 py-2 text-xs font-mono text-gray-900"
          />

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-700">
              <input type="checkbox" checked={replaceAll} onChange={(e) => setReplaceAll(e.target.checked)} />
              Replace All Existing Mappings
            </label>
            <button
              onClick={saveMappings}
              disabled={saving}
              className="px-4 py-2 rounded-xl bg-emerald-700 text-white font-black text-xs uppercase tracking-widest hover:bg-emerald-800 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Mappings"}
            </button>
          </div>

          {saveMessage && <div className="mt-3 text-sm font-semibold text-emerald-700">{saveMessage}</div>}
          {error && <div className="mt-3 text-sm font-semibold text-red-700">{error}</div>}
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 text-sm font-black uppercase tracking-widest text-gray-700">
            Current Mappings ({rows.length})
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[1000px] w-full border-collapse">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {["Cost Item", "Cost Type", "PMC Group", "Source", "Updated"].map((label) => (
                    <th key={label} className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-wider text-gray-600">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-gray-100">
                    <td className="px-3 py-2 text-sm text-gray-800">{row.costItem}</td>
                    <td className="px-3 py-2 text-sm text-gray-800">{row.costType || "-"}</td>
                    <td className="px-3 py-2 text-sm text-gray-800">{row.pmcGroup}</td>
                    <td className="px-3 py-2 text-sm text-gray-800">{row.source || "-"}</td>
                    <td className="px-3 py-2 text-sm text-gray-800">{new Date(row.updatedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
