"use client";
import React, { useState, useEffect } from "react";
import { normalizeProcoreCostItemUnit, normalizeProcoreLaborTimeUnit } from "@/lib/procoreUnits";


interface ProcoreData {
  user?: any;
  companies?: any;
  projects?: any;
  projectTemplates?: any;
  vendors?: any;
  users?: any;
  bidBoardProjects?: any;
  estimatingProjects?: any;
  bidBoardV2?: any;
  unifiedProjects?: any;
  productivityLogs?: any;
  giantProductivity?: any;
  error?: string;
}

export default function ProcorePage() {
  return <ProcoreContent />;
}

function ProcoreContent() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [data, setData] = useState<ProcoreData | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncingProductivity, setSyncingProductivity] = useState(false);
  const [debugging, setDebugging] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [checkingDatabase, setCheckingDatabase] = useState(false);
  const [syncResult, setSyncResult] = useState<{ count: number; message: string } | null>(null);
  const [productivityResult, setProductivityResult] = useState<{ count: number; message: string } | null>(null);
  const [debugResult, setDebugResult] = useState<any>(null);
  const [productivityDebugResult, setProductivityDebugResult] = useState<any>(null);
  const [createProductivityProjectId, setCreateProductivityProjectId] = useState("");
  const [createProductivityJson, setCreateProductivityJson] = useState('{\n  "date": "2026-06-08",\n  "line_item_id": 173890,\n  "notes": "Productivity 50% complete",\n  "quantity_delivered": "10",\n  "quantity_used": "4"\n}');
  const [createProductivityBusy, setCreateProductivityBusy] = useState(false);
  const [createProductivityError, setCreateProductivityError] = useState<string | null>(null);
  const [createProductivityResult, setCreateProductivityResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedSection, setSelectedSection] = useState<string | null>(null);
  const [importBidBoardProjectId, setImportBidBoardProjectId] = useState("");
  const [importProposalName, setImportProposalName] = useState("Imported Estimate");
  const [importProposalId, setImportProposalId] = useState("");
  const [importRowsText, setImportRowsText] = useState("[]");
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importWorkbookSummary, setImportWorkbookSummary] = useState<string | null>(null);
  const [projectImportRowsText, setProjectImportRowsText] = useState("[]");
  const [projectImportBusy, setProjectImportBusy] = useState(false);
  const [projectImportResult, setProjectImportResult] = useState<any>(null);
  const [projectImportError, setProjectImportError] = useState<string | null>(null);
  const [projectImportWorkbookSummary, setProjectImportWorkbookSummary] = useState<string | null>(null);

  // Step 2: Line Item Groups import state
  const [groupImportBidBoardProjectId, setGroupImportBidBoardProjectId] = useState("");
  const [groupImportProposalId, setGroupImportProposalId] = useState("");
  const [groupImportRowsText, setGroupImportRowsText] = useState("[]");
  const [groupImportBusy, setGroupImportBusy] = useState(false);
  const [groupImportResult, setGroupImportResult] = useState<any>(null);
  const [groupImportError, setGroupImportError] = useState<string | null>(null);
  const [groupImportWorkbookSummary, setGroupImportWorkbookSummary] = useState<string | null>(null);

  // Step 3: Line Items import state
  const [lineItemImportBidBoardProjectId, setLineItemImportBidBoardProjectId] = useState("");
  const [lineItemImportProposalId, setLineItemImportProposalId] = useState("");
  const [lineItemImportRowsText, setLineItemImportRowsText] = useState("[]");
  const [lineItemImportBusy, setLineItemImportBusy] = useState(false);
  const [lineItemImportResult, setLineItemImportResult] = useState<any>(null);
  const [lineItemImportError, setLineItemImportError] = useState<string | null>(null);
  const [lineItemImportWorkbookSummary, setLineItemImportWorkbookSummary] = useState<string | null>(null);
  const [lineItemPayloadPullBusy, setLineItemPayloadPullBusy] = useState(false);
  const [lineItemPayloadPullResult, setLineItemPayloadPullResult] = useState<any>(null);
  const [lineItemPayloadPullError, setLineItemPayloadPullError] = useState<string | null>(null);
  const [lineItemImportViaImportBusy, setLineItemImportViaImportBusy] = useState(false);
  const [lineItemImportViaImportResult, setLineItemImportViaImportResult] = useState<any>(null);
  const [lineItemImportViaImportError, setLineItemImportViaImportError] = useState<string | null>(null);
  const [singleLineItemJson, setSingleLineItemJson] = useState('{\n  "name": "Mobilization",\n  "group_id": "",\n  "labor_factor": 1,\n  "count": 1,\n  "labor_cost": 125,\n  "cost_item": {\n    "id": "51482200",\n    "type": "Labor",\n    "name": "Mobilization",\n    "unit": "Hours"\n  }\n}');
  const [singleLineItemBusy, setSingleLineItemBusy] = useState(false);
  const [singleLineItemError, setSingleLineItemError] = useState<string | null>(null);
  const [singleLineItemResult, setSingleLineItemResult] = useState<any>(null);

  // Direct Cost Line Items Sync
  const [directCostProjectId, setDirectCostProjectId] = useState("");
  const [directCostRowsText, setDirectCostRowsText] = useState("[]");
  const [directCostBusy, setDirectCostBusy] = useState(false);
  const [directCostResult, setDirectCostResult] = useState<any>(null);
  const [directCostError, setDirectCostError] = useState<string | null>(null);
  const [directCostWorkbookSummary, setDirectCostWorkbookSummary] = useState<string | null>(null);

  useEffect(() => {
    const checkProcoreAuth = async () => {
      try {
        console.log("ProcorePage: Checking auth...");
        const response = await fetch("/api/procore/me");
        if (response.ok) {
          try {
            const data = await response.json();
            console.log("ProcorePage: Auth OK");
            setIsAuthenticated(true);
          } catch (e) {
            console.warn("Failed to parse auth response");
            setIsAuthenticated(false);
          }
        } else {
          console.warn("ProcorePage: Auth endpoint not available");
          // Don't set error state here to avoid showing it on initial load
          setIsAuthenticated(false);
        }
      } catch (err) {
        console.warn("Error checking Procore auth:", err);
        setIsAuthenticated(false);
      }
    };

    const params = new URLSearchParams(window.location.search);
    if (params.get("status") === "authenticated") {
      setIsAuthenticated(true);
      window.history.replaceState({}, "", "/procore");
    } else {
      checkProcoreAuth();
    }
    
    if (params.get("error")) {
      setError(params.get("error"));
    }
  }, []);

  const handleLogin = () => {
    // Procore API access requires the dedicated Procore OAuth flow.
    const loginUrl = "/api/auth/procore/login";
    if (typeof window !== 'undefined' && window.self !== window.top) {
      window.top!.location.href = loginUrl;
      return;
    }
    window.location.href = loginUrl;
  };

  const handleExplore = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/procore/explore", {
        method: "POST",
      });

      if (!response.ok) {
        console.warn("Procore explore endpoint not available");
        setData(null);
        return;
      }

      try {
        const result = await response.json();
        setData(result);
      } catch (e) {
        console.warn("Failed to parse explore response");
        setData(null);
      }
    } catch (err) {
      console.warn("Error exploring Procore:", err);
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    setSyncResult(null);
    try {
      const response = await fetch("/api/procore/sync", {
        method: "POST",
      });

      if (!response.ok) {
        console.warn("Procore sync endpoint not available");
        return;
      }

      try {
        const result = await response.json();
        setSyncResult({ count: result.count, message: result.message });
      } catch (e) {
        console.warn("Failed to parse sync response");
      }
    } catch (err) {
      console.warn("Error syncing Procore:", err);
    } finally {
      setSyncing(false);
    }
  };

  const handleSyncProductivity = async () => {
    setSyncingProductivity(true);
    setError(null);
    setProductivityResult(null);
    setProductivityDebugResult(null);
    try {
      const response = await fetch("/api/procore/sync-productivity", {
        method: "POST",
      });

      if (!response.ok) {
        console.warn("Procore sync-productivity endpoint not available");
        return;
      }

      try {
        const result = await response.json();
        setProductivityResult({ 
          count: result.totalLogs, 
          message: result.message 
        });
        
        // Store debug info if available
        if (result.debug) {
          setProductivityDebugResult(result.debug);
        }
      } catch (e) {
        console.warn("Failed to parse sync-productivity response");
      }
    } catch (err) {
      console.warn("Error syncing productivity:", err);
    } finally {
      setSyncingProductivity(false);
    }
  };

  const handleDebugProductivity = async () => {
    setDebugging(true);
    setError(null);
    setDebugResult(null);
    try {
      const response = await fetch("/api/procore/debug-productivity", {
        method: "POST",
      });

      if (!response.ok) {
        console.warn("Procore debug-productivity endpoint not available");
        return;
      }

      try {
        const result = await response.json();
        setDebugResult(result);
      } catch (e) {
        console.warn("Failed to parse debug-productivity response");
      }
    } catch (err) {
      console.warn("Error debugging productivity:", err);
    } finally {
      setDebugging(false);
    }
  };

  const handleClearProductivity = async () => {
    if (!window.confirm('This will delete all old productivity data. Are you ready to sync fresh data after this?')) {
      return;
    }
    
    setClearing(true);
    setError(null);
    try {
      const response = await fetch("/api/procore/clear-productivity", {
        method: "POST",
      });

      if (!response.ok) {
        console.warn("Procore clear-productivity endpoint not available");
        return;
      }

      try {
        const result = await response.json();
        setError(`OK ${result.message}`);
      } catch (e) {
        console.warn("Failed to parse clear-productivity response");
      }
    } catch (err) {
      console.warn("Error clearing productivity:", err);
    } finally {
      setClearing(false);
    }
  };

  const handleCheckDatabase = async () => {
    setCheckingDatabase(true);
    setError(null);
    setDebugResult(null);
    try {
      const response = await fetch("/api/status");

      if (!response.ok) {
        console.warn("Status endpoint not available");
        return;
      }

      try {
        const result = await response.json();
        setDebugResult(result);
      } catch (e) {
        console.warn("Failed to parse check-database response");
      }
    } catch (err) {
      console.warn('Error checking database:', err);
    } finally {
      setCheckingDatabase(false);
    }
  };

  const handleCreateProductivityLog = async () => {
    const projectId = createProductivityProjectId.trim();
    if (!projectId) {
      setCreateProductivityError("Project ID is required.");
      return;
    }

    let productivityLogPayload: Record<string, unknown>;
    try {
      const parsed = JSON.parse(createProductivityJson);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("JSON must be an object.");
      }
      productivityLogPayload = parsed as Record<string, unknown>;
    } catch (e) {
      setCreateProductivityError(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    setCreateProductivityBusy(true);
    setCreateProductivityError(null);
    setCreateProductivityResult(null);
    try {
      const response = await fetch("/api/procore/productivity-logs/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, productivity_log: productivityLogPayload }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setCreateProductivityError(
          result?.error
            ? `${result.error}${result?.details ? `: ${result.details}` : ""}`
            : `Create failed (${response.status}).`
        );
      }
      setCreateProductivityResult({ status: response.status, ok: response.ok, result });
    } catch (err) {
      setCreateProductivityError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreateProductivityBusy(false);
    }
  };

  const parseImportRows = (): Record<string, unknown>[] => {
    const parsed = JSON.parse(importRowsText || "[]");
    if (!Array.isArray(parsed)) {
      throw new Error("Rows input must be a JSON array of objects.");
    }
    const rows = parsed.filter((row) => row && typeof row === "object");
    if (rows.length === 0) {
      throw new Error("Rows input is empty. Paste workbook rows as a JSON array.");
    }
    return rows as Record<string, unknown>[];
  };

  const handleEstimateWorkbookImport = async (dryRun: boolean) => {
    const bidBoardProjectId = importBidBoardProjectId.trim();
    if (!bidBoardProjectId) {
      setImportError("Bid Board Project ID is required.");
      return;
    }

    if (!dryRun) {
      const confirmed = window.confirm(
        "This will create real proposal/groups/line-items in Procore. Continue with live import?"
      );
      if (!confirmed) return;
    }

    let rows: Record<string, unknown>[] = [];
    try {
      rows = parseImportRows();
    } catch (parseError) {
      const message = parseError instanceof Error ? parseError.message : String(parseError);
      setImportError(message);
      return;
    }

    setImportBusy(true);
    setImportError(null);
    setImportResult(null);

    try {
      const payload: Record<string, unknown> = {
        bidBoardProjectId,
        dryRun,
        rows,
        createProposal: !importProposalId.trim(),
      };

      if (importProposalId.trim()) {
        payload.proposalId = importProposalId.trim();
      } else {
        payload.proposal = {
          name: importProposalName.trim() || "Imported Estimate",
        };
      }

      const response = await fetch("/api/procore/estimating/import-estimate-workbook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        const details = typeof result?.details === "string" ? result.details : "Unknown import error";
        throw new Error(details);
      }

      if (!dryRun && typeof result?.proposalId === "string" && result.proposalId.trim()) {
        setImportProposalId(result.proposalId);
      }

      setImportResult(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setImportError(message);
    } finally {
      setImportBusy(false);
    }
  };

  const handleWorkbookFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportError(null);
    setImportWorkbookSummary(null);

    try {
      const XLSX = await import("xlsx");
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: "array" });

      if (!workbook.SheetNames.length) {
        throw new Error("Workbook has no sheets.");
      }

      let selectedSheetName = workbook.SheetNames[0];
      let selectedRows: Record<string, unknown>[] = [];

      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) continue;
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
        if (rows.length > 0) {
          selectedSheetName = sheetName;
          selectedRows = rows;
          break;
        }
      }

      if (selectedRows.length === 0) {
        throw new Error("No row data found in workbook sheets.");
      }

      setImportRowsText(JSON.stringify(selectedRows, null, 2));
      setImportWorkbookSummary(
        `${file.name}: loaded ${selectedRows.length} rows from sheet \"${selectedSheetName}\".`
      );
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : String(uploadError);
      setImportError(`Failed to parse workbook: ${message}`);
    } finally {
      event.target.value = "";
    }
  };

  const parseProjectImportRows = (): Record<string, unknown>[] => {
    const parsed = JSON.parse(projectImportRowsText || "[]");
    if (!Array.isArray(parsed)) {
      throw new Error("Project rows input must be a JSON array of objects.");
    }
    const rows = parsed.filter((row) => row && typeof row === "object");
    if (rows.length === 0) {
      throw new Error("Project rows input is empty. Upload workbook rows or paste JSON.");
    }
    return rows as Record<string, unknown>[];
  };

  const getRowString = (row: Record<string, unknown>, keys: string[]): string => {
    for (const key of keys) {
      const value = row[key];
      if (value === null || value === undefined) continue;
      const text = String(value).trim();
      if (text) return text;
    }
    return "";
  };

  const getRowBoolean = (row: Record<string, unknown>, keys: string[]): boolean | undefined => {
    for (const key of keys) {
      const value = row[key];
      if (typeof value === "boolean") return value;
      if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "true") return true;
        if (normalized === "false") return false;
      }
    }
    return undefined;
  };

  const getRowNumber = (row: Record<string, unknown>, keys: string[]): number | undefined => {
    for (const key of keys) {
      const value = row[key];
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "string") {
        const parsed = Number(value.trim());
        if (Number.isFinite(parsed)) return parsed;
      }
    }
    return undefined;
  };

  const buildBidBoardProjectPayloadFromRow = (row: Record<string, unknown>) => {
    const payload: Record<string, unknown> = {
      name: getRowString(row, ["name", "Name"]),
      status: getRowString(row, ["status", "Status"]) || "ESTIMATING",
    };

    const description = getRowString(row, ["description", "Description"]);
    const dueDate = getRowString(row, ["due_date", "dueDate", "Due Date", "due date"]);
    const projectNumber = getRowString(row, ["project_number", "projectNumber", "Project Number", "project number"]);
    const squareFootage = getRowNumber(row, ["square_footage", "squareFootage", "Square Footage", "square footage"]);

    const isTemplate = getRowBoolean(row, ["is_template", "isTemplate", "as_template", "asTemplate", "template"]);
    const useMetricUnits = getRowBoolean(row, ["use_metric_units", "useMetricUnits"]);
    const useTaxFromCost = getRowBoolean(row, ["use_tax_from_cost", "useTaxFromCost"]);
    const individualLaborRates = getRowBoolean(row, ["individual_labor_rates", "individualLaborRates"]);
    const useUnitLaborCost = getRowBoolean(row, ["use_unit_labor_cost", "useUnitLaborCost"]);
    const wbsValidationEnabled = getRowBoolean(row, ["wbs_validation_enabled", "wbsValidationEnabled"]);
    const disableEaPartsRounding = getRowBoolean(row, ["disable_ea_parts_rounding", "disableEaPartsRounding"]);

    if (description) payload.description = description;
    if (dueDate) payload.due_date = dueDate;
    if (projectNumber) payload.project_number = projectNumber;
    if (squareFootage !== undefined) payload.square_footage = squareFootage;
    if (isTemplate !== undefined) payload.is_template = isTemplate;
    if (useMetricUnits !== undefined) payload.use_metric_units = useMetricUnits;
    if (useTaxFromCost !== undefined) payload.use_tax_from_cost = useTaxFromCost;
    if (individualLaborRates !== undefined) payload.individual_labor_rates = individualLaborRates;
    if (useUnitLaborCost !== undefined) payload.use_unit_labor_cost = useUnitLaborCost;
    if (wbsValidationEnabled !== undefined) payload.wbs_validation_enabled = wbsValidationEnabled;
    if (disableEaPartsRounding !== undefined) payload.disable_ea_parts_rounding = disableEaPartsRounding;

    const addressStreet = getRowString(row, ["address.street", "address_street", "Address Street"]);
    const addressCity = getRowString(row, ["address.city", "address_city", "Address City"]);
    const addressState = getRowString(row, ["address.state", "address_state", "Address State"]);
    const addressZip = getRowString(row, ["address.zip", "address_zip", "Address Zip"]);
    const addressCountry = getRowString(row, ["address.country", "address_country", "Address Country"]);

    if (addressStreet || addressCity || addressState || addressZip || addressCountry) {
      payload.address = {
        ...(addressStreet ? { street: addressStreet } : {}),
        ...(addressCity ? { city: addressCity } : {}),
        ...(addressState ? { state: addressState } : {}),
        ...(addressZip ? { zip: addressZip } : {}),
        ...(addressCountry ? { country: addressCountry } : {}),
      };
    }

    return payload;
  };

  const handleBidBoardProjectWorkbookUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setProjectImportError(null);
    setProjectImportWorkbookSummary(null);

    try {
      const XLSX = await import("xlsx");
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: "array" });

      if (!workbook.SheetNames.length) {
        throw new Error("Workbook has no sheets.");
      }

      let selectedSheetName = workbook.SheetNames[0];
      let selectedRows: Record<string, unknown>[] = [];

      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) continue;
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
        if (rows.length > 0) {
          selectedSheetName = sheetName;
          selectedRows = rows;
          break;
        }
      }

      if (selectedRows.length === 0) {
        throw new Error("No row data found in workbook sheets.");
      }

      setProjectImportRowsText(JSON.stringify(selectedRows, null, 2));
      setProjectImportWorkbookSummary(
        `${file.name}: loaded ${selectedRows.length} rows from sheet "${selectedSheetName}".`
      );
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : String(uploadError);
      setProjectImportError(`Failed to parse workbook: ${message}`);
    } finally {
      event.target.value = "";
    }
  };

  const handleCreateBidBoardProjectsFromRows = async () => {
    let rows: Record<string, unknown>[] = [];
    try {
      rows = parseProjectImportRows();
    } catch (parseError) {
      const message = parseError instanceof Error ? parseError.message : String(parseError);
      setProjectImportError(message);
      return;
    }

    const confirmed = window.confirm(
      `This will create ${rows.length} Bid Board project(s) in Procore. Continue?`
    );
    if (!confirmed) return;

    setProjectImportBusy(true);
    setProjectImportError(null);
    setProjectImportResult(null);

    try {
      const results: Array<Record<string, unknown>> = [];

      for (let index = 0; index < rows.length; index += 1) {
        const sourceRow = rows[index];
        const payload = buildBidBoardProjectPayloadFromRow(sourceRow);

        if (!payload.name || typeof payload.name !== "string" || !payload.name.trim()) {
          results.push({
            index,
            ok: false,
            error: "Missing required field: name",
            payload,
          });
          continue;
        }

        const response = await fetch("/api/procore/estimating/bid-board-projects-create", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        const result = await response.json().catch(() => ({}));
        results.push({
          index,
          ok: response.ok,
          status: response.status,
          payload,
          result,
        });
      }

      const created = results.filter((entry) => entry.ok).length;
      const failed = results.length - created;
      setProjectImportResult({
        source: "estimating.create_bid_board_project.bulk_from_rows",
        attempted: results.length,
        created,
        failed,
        results,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setProjectImportError(message);
    } finally {
      setProjectImportBusy(false);
    }
  };

  const handlePreviewBidBoardProjectsFromRows = () => {
    let rows: Record<string, unknown>[] = [];
    try {
      rows = parseProjectImportRows();
    } catch (parseError) {
      const message = parseError instanceof Error ? parseError.message : String(parseError);
      setProjectImportError(message);
      return;
    }

    setProjectImportError(null);
    const previewResults = rows.map((sourceRow, index) => {
      const payload = buildBidBoardProjectPayloadFromRow(sourceRow);
      const hasName = typeof payload.name === "string" && payload.name.trim().length > 0;
      return {
        index,
        ok: hasName,
        error: hasName ? null : "Missing required field: name",
        payload,
      };
    });

    const valid = previewResults.filter((entry) => entry.ok).length;
    const invalid = previewResults.length - valid;

    setProjectImportResult({
      source: "estimating.create_bid_board_project.bulk_from_rows",
      mode: "dry-run",
      attempted: previewResults.length,
      created: 0,
      failed: invalid,
      valid,
      invalid,
      results: previewResults,
    });
  };

  // ── Step 2: Line Item Groups helpers ────────────────────────────────────────

  const parseGroupImportRows = (): Record<string, unknown>[] => {
    try {
      const parsed = JSON.parse(groupImportRowsText);
      if (!Array.isArray(parsed)) throw new Error("Rows JSON must be an array.");
      return parsed as Record<string, unknown>[];
    } catch (e) {
      throw new Error(`Invalid Rows JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const buildGroupPayloadFromRow = (row: Record<string, unknown>): Record<string, unknown> => {
    const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
    const num = (v: unknown): number | undefined => {
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "string" && v.trim() !== "") { const n = Number(v); if (Number.isFinite(n)) return n; }
      return undefined;
    };
    const bool = (v: unknown): boolean | undefined => {
      if (typeof v === "boolean") return v;
      if (typeof v === "string") { const s = v.trim().toLowerCase(); if (s === "true") return true; if (s === "false") return false; }
      return undefined;
    };

    const payload: Record<string, unknown> = {};
    const name = str(row.name);
    if (name) payload.name = name;
    const notes = str(row.notes);
    if (notes) payload.notes = notes;
    const multiplier = num(row.multiplier);
    if (multiplier !== undefined) payload.multiplier = multiplier;

    const po: Record<string, unknown> = {};
    const numFields: Array<[string, string]> = [
      ["unit_material_cost", "unitMaterialCost"],
      ["material_margin", "materialMargin"],
      ["unit_labor", "unitLabor"],
      ["labor_factor", "laborFactor"],
      ["unit_labor_rate", "unitLaborRate"],
      ["unit_labor_cost", "unitLaborCost"],
      ["labor_margin", "laborMargin"],
    ];
    for (const [snake, camel] of numFields) {
      const v = num(row[snake] ?? row[camel]);
      if (v !== undefined) po[snake] = v;
    }
    const isUntaxed = bool(row.is_untaxed ?? row.isUntaxed);
    if (isUntaxed !== undefined) po.is_untaxed = isUntaxed;
    if (Object.keys(po).length > 0) payload.pricing_override = po;

    return payload;
  };

  const handleGroupWorkbookUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setGroupImportError(null);
    setGroupImportWorkbookSummary(null);
    try {
      const XLSX = await import("xlsx");
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: "array" });
      if (!workbook.SheetNames.length) throw new Error("Workbook has no sheets.");
      let selectedSheetName = workbook.SheetNames[0];
      let selectedRows: Record<string, unknown>[] = [];
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) continue;
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
        if (rows.length > 0) { selectedSheetName = sheetName; selectedRows = rows; break; }
      }
      if (selectedRows.length === 0) throw new Error("No row data found in workbook sheets.");
      setGroupImportRowsText(JSON.stringify(selectedRows, null, 2));
      setGroupImportWorkbookSummary(`${file.name}: loaded ${selectedRows.length} rows from sheet "${selectedSheetName}".`);
    } catch (uploadError) {
      setGroupImportError(`Failed to parse workbook: ${uploadError instanceof Error ? uploadError.message : String(uploadError)}`);
    } finally {
      event.target.value = "";
    }
  };

  const handlePreviewGroupsFromRows = () => {
    let rows: Record<string, unknown>[] = [];
    try { rows = parseGroupImportRows(); } catch (e) { setGroupImportError(e instanceof Error ? e.message : String(e)); return; }
    setGroupImportError(null);
    const previewResults = rows.map((sourceRow, index) => {
      const payload = buildGroupPayloadFromRow(sourceRow);
      const hasName = typeof payload.name === "string" && (payload.name as string).trim().length > 0;
      return { index, ok: hasName, error: hasName ? null : "Missing required field: name", payload };
    });
    const valid = previewResults.filter((r) => r.ok).length;
    const invalid = previewResults.length - valid;
    setGroupImportResult({ source: "estimating.create_line_item_group.bulk_from_rows", mode: "dry-run", attempted: previewResults.length, valid, invalid, failed: invalid, results: previewResults });
  };

  const handleCreateGroupsFromRows = async () => {
    const bidBoardProjectId = groupImportBidBoardProjectId.trim();
    const proposalId = groupImportProposalId.trim();
    if (!bidBoardProjectId || !proposalId) { setGroupImportError("Bid Board Project ID and Proposal ID are required."); return; }

    let rows: Record<string, unknown>[] = [];
    try { rows = parseGroupImportRows(); } catch (e) { setGroupImportError(e instanceof Error ? e.message : String(e)); return; }

    if (!window.confirm(`This will create ${rows.length} line item group(s) in Procore. Continue?`)) return;

    setGroupImportBusy(true);
    setGroupImportError(null);
    setGroupImportResult(null);
    try {
      const results: Array<Record<string, unknown>> = [];
      for (let index = 0; index < rows.length; index++) {
        const payload = buildGroupPayloadFromRow(rows[index]);
        if (!payload.name || !(payload.name as string).trim()) {
          results.push({ index, ok: false, error: "Missing required field: name", payload });
          continue;
        }
        const response = await fetch("/api/procore/estimating/proposal-line-item-groups-create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bidBoardProjectId, proposalId, ...payload }),
        });
        const result = await response.json().catch(() => ({}));
        results.push({ index, ok: response.ok, status: response.status, payload, result });
      }
      const created = results.filter((r) => r.ok).length;
      setGroupImportResult({ source: "estimating.create_line_item_group.bulk_from_rows", attempted: results.length, created, failed: results.length - created, results });
    } catch (err) {
      setGroupImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setGroupImportBusy(false);
    }
  };

  // ── Step 3: Line Items helpers ────────────────────────────────────────────

  const parseLineItemImportRows = (): Record<string, unknown>[] => {
    try {
      const parsed = JSON.parse(lineItemImportRowsText);
      if (!Array.isArray(parsed)) throw new Error("Rows JSON must be an array.");
      const rows = (parsed as unknown[]).filter(
        (entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null
      );
      return rows.filter((row) =>
        Object.values(row).some((value) => {
          if (value === null || value === undefined) return false;
          if (typeof value === "string") return value.trim() !== "";
          return true;
        })
      );
    } catch (e) {
      throw new Error(`Invalid Rows JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const buildLineItemPayloadFromRow = (row: Record<string, unknown>): Record<string, unknown> => {
    const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
    const readCostCode = (v: unknown): string => {
      if (v && typeof v === "object") {
        const rec = v as Record<string, unknown>;
        return str(rec.code ?? rec.name ?? rec.value);
      }
      return str(v);
    };
    const num = (v: unknown): number | undefined => {
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "string" && v.trim() !== "") { const n = Number(v); if (Number.isFinite(n)) return n; }
      return undefined;
    };
    const bool = (v: unknown): boolean | undefined => {
      if (typeof v === "boolean") return v;
      if (typeof v === "string") { const s = v.trim().toLowerCase(); if (s === "true") return true; if (s === "false") return false; }
      return undefined;
    };
    const payload: Record<string, unknown> = {};
    const name = str(row.name);
    if (name) payload.name = name;
    const projectId = str(row.project_id ?? row.projectId);
    if (projectId) payload.project_id = projectId;
    const groupId = str(row.group_id ?? row.groupId);
    if (groupId) payload.group_id = groupId;
    const tag = str(row.tag);
    if (tag) payload.tag = tag;
    const laborFactor = num(row.labor_factor ?? row.laborFactor);
    if (laborFactor !== undefined) payload.labor_factor = laborFactor;
    const count = num(row.count ?? row.quantity ?? row.qty);
    if (count !== undefined) payload.count = count;
    const itemCost = num(row.item_cost ?? row.itemCost);
    if (itemCost !== undefined) payload.item_cost = itemCost;
    const laborCost = num(row.labor_cost ?? row.laborCost);
    if (laborCost !== undefined) payload.labor_cost = laborCost;
    const budgetCode = readCostCode(row.budget_code ?? row["cost_code.code"] ?? row.cost_code ?? row.costCode);
    if (budgetCode) payload.cost_code = { code: budgetCode };

    // Build cost_item from ci_ prefixed flat columns
    const ci: Record<string, unknown> = {};
    const ciStrFields: Array<[string, string[]]> = [
      ["type",             ["ci_type", "cost_item.type"]],
      ["name",             ["ci_name", "ci_costItemName", "cost_item.name"]],
      ["description",      ["ci_description", "cost_item.description"]],
      ["unit",             ["ci_unit", "cost_item.unit"]],
      ["labor_time_unit",  ["ci_labor_time_unit", "ci_laborTimeUnit", "cost_item.labor_time_unit"]],
      ["manufacturer",     ["ci_manufacturer", "cost_item.manufacturer"]],
      ["catalog_number",   ["ci_catalog_number", "ci_catalogNumber", "cost_item.catalog_number"]],
      ["url",              ["ci_url", "cost_item.url"]],
      ["supplier",         ["ci_supplier", "cost_item.supplier"]],
      ["notes",            ["ci_notes", "ci_costItemNotes", "cost_item.notes"]],
      ["id",               ["ci_id", "ci_costItemId", "ci_item_id", "ci_itemId", "cost_item.id"]],
      ["color",            ["ci_color", "cost_item.color"]],
      ["symbol_id",        ["ci_symbol_id", "ci_symbolId", "cost_item.symbol_id"]],
      ["catalog_id",       ["ci_catalog_id", "ci_catalogId", "cost_item.catalog_id"]],
      ["based_on_item_id", ["ci_based_on_item_id", "ci_basedOnItemId", "cost_item.based_on_item_id"]],
    ];
    const ciNumFields: Array<[string, string[]]> = [
      ["unit_cost",       ["ci_unit_cost", "ci_unitCost", "cost_item.unit_cost"]],
      ["unit_labor",      ["ci_unit_labor", "ci_unitLabor", "cost_item.unit_labor"]],
      ["unit_labor_cost", ["ci_unit_labor_cost", "ci_unitLaborCost", "cost_item.unit_labor_cost"]],
      ["unit_labor_rate", ["ci_unit_labor_rate", "ci_unitLaborRate", "cost_item.unit_labor_rate"]],
      ["waste",           ["ci_waste", "cost_item.waste"]],
      ["material_waste",  ["ci_material_waste", "ci_materialWaste", "cost_item.material_waste"]],
      ["item_margin",     ["ci_item_margin", "ci_itemMargin", "cost_item.item_margin"]],
      ["labor_margin",    ["ci_labor_margin", "ci_laborMargin", "cost_item.labor_margin"]],
      ["delivery_unit",   ["ci_delivery_unit", "ci_deliveryUnit", "cost_item.delivery_unit"]],
    ];
    for (const [snake, keys] of ciStrFields) {
      const v = str(keys.reduce<unknown>((acc, k) => acc ?? row[k], undefined));
      if (v) ci[snake] = v;
    }
    for (const [snake, keys] of ciNumFields) {
      const v = num(keys.reduce<unknown>((acc, k) => acc ?? row[k], undefined));
      if (v !== undefined) ci[snake] = v;
    }
    if (typeof ci.labor_time_unit === "string") {
        const normalizedLaborTimeUnit = normalizeProcoreLaborTimeUnit(ci.labor_time_unit);
        if (normalizedLaborTimeUnit) {
          ci.labor_time_unit = normalizedLaborTimeUnit;
        } else {
          delete ci.labor_time_unit;
        }
    }
    if (typeof ci.unit === "string") {
        ci.unit = normalizeProcoreCostItemUnit(ci.unit);
    }
    const isUntaxed = bool(row.ci_is_untaxed ?? row.ci_isUntaxed ?? row["cost_item.is_untaxed"]);
    if (isUntaxed !== undefined) ci.is_untaxed = isUntaxed;
    if (Object.keys(ci).length > 0) payload.cost_item = ci;

    const normalizedCostItemType = typeof ci.type === "string" ? ci.type.trim().toLowerCase() : "";
    if (normalizedCostItemType === "labor") {
      delete payload.item_cost;
      delete ci.unit_cost;
    }

    return payload;
  };

  const handleLineItemWorkbookUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setLineItemImportError(null);
    setLineItemImportWorkbookSummary(null);
    try {
      const XLSX = await import("xlsx");
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: "array" });
      if (!workbook.SheetNames.length) throw new Error("Workbook has no sheets.");
      let selectedSheetName = workbook.SheetNames[0];
      let selectedRows: Record<string, unknown>[] = [];
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) continue;
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
        if (rows.length > 0) { selectedSheetName = sheetName; selectedRows = rows; break; }
      }
      if (selectedRows.length === 0) throw new Error("No row data found in workbook sheets.");
      setLineItemImportRowsText(JSON.stringify(selectedRows, null, 2));
      setLineItemImportWorkbookSummary(`${file.name}: loaded ${selectedRows.length} rows from sheet "${selectedSheetName}".`);
    } catch (uploadError) {
      setLineItemImportError(`Failed to parse workbook: ${uploadError instanceof Error ? uploadError.message : String(uploadError)}`);
    } finally {
      event.target.value = "";
    }
  };

  const normalizeGroupNameKey = (value: string): string => {
    return value
      .toLowerCase()
      .replace(/[\u2010-\u2015]/g, "-")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  };

  // Fetch all groups for a proposal and return a normalized-name -> id map
  const fetchGroupNameMap = async (bidBoardProjectId: string, proposalId: string): Promise<Record<string, string>> => {
    try {
      const res = await fetch("/api/procore/estimating/proposal-line-item-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bidBoardProjectId, proposalId, perPage: 200 }),
      });
      if (!res.ok) return {};
      const data = await res.json().catch(() => ({}));
      const groups: unknown[] = Array.isArray(data.groups) ? data.groups
        : Array.isArray(data.data) ? data.data
        : Array.isArray(data) ? data : [];
      const map: Record<string, string> = {};
      for (const g of groups) {
        if (g && typeof g === "object") {
          const rec = g as Record<string, unknown>;
          const id = String(rec.id || "").trim();
          const name = String(rec.name || "").trim();
          if (id && name) map[normalizeGroupNameKey(name)] = id;
        }
      }
      return map;
    } catch {
      return {};
    }
  };

  // Copy a row and inject group_id from name map if group_name is present
  const resolveGroupName = (row: Record<string, unknown>, nameMap: Record<string, string>): Record<string, unknown> => {
    const groupName = typeof row.group_name === "string" ? row.group_name.trim() : "";
    if (!groupName) return row;
    const resolvedId = nameMap[normalizeGroupNameKey(groupName)];
    return { ...row, group_id: resolvedId || row.group_id || "" };
  };

  const handlePreviewLineItemsFromRows = async () => {
    const bidBoardProjectId = lineItemImportBidBoardProjectId.trim();
    const proposalId = lineItemImportProposalId.trim();
    let rows: Record<string, unknown>[] = [];
    try { rows = parseLineItemImportRows(); } catch (e) { setLineItemImportError(e instanceof Error ? e.message : String(e)); return; }
    setLineItemImportError(null);

    // Fetch group name→id map if any row uses group_name and IDs are provided
    let groupNameMap: Record<string, string> = {};
    const hasGroupNames = rows.some((r) => typeof r.group_name === "string" && (r.group_name as string).trim());
    if (hasGroupNames && bidBoardProjectId && proposalId) {
      groupNameMap = await fetchGroupNameMap(bidBoardProjectId, proposalId);
    }

    const previewResults = rows.map((sourceRow, index) => {
      const resolvedRow = resolveGroupName(sourceRow, groupNameMap);
      const payload = buildLineItemPayloadFromRow(resolvedRow);
      const hasName = typeof payload.name === "string" && (payload.name as string).trim().length > 0;
      const payloadCostItem = payload.cost_item as Record<string, unknown> | undefined;
      const hasItemId = typeof payloadCostItem?.id === "string" && payloadCostItem.id.trim().length > 0;
      const groupName = typeof sourceRow.group_name === "string" ? (sourceRow.group_name as string).trim() : "";
      const groupWarning = groupName && !resolvedRow.group_id ? `group_name "${groupName}" not found in proposal` : null;
      const error = !hasName
        ? "Missing required field: name"
        : !hasItemId
          ? "Missing required field: cost_item.id (use ci_item_id or ci_itemId)"
          : null;
      return { index, ok: !error, error, groupWarning, payload };
    });
    const valid = previewResults.filter((r) => r.ok).length;
    const invalid = previewResults.length - valid;
    setLineItemImportResult({ source: "estimating.create_line_item.bulk_from_rows", mode: "dry-run", attempted: previewResults.length, valid, invalid, failed: invalid, results: previewResults });
  };

  const handleCreateLineItemsFromRows = async () => {
    const bidBoardProjectId = lineItemImportBidBoardProjectId.trim();
    const proposalId = lineItemImportProposalId.trim();
    if (!bidBoardProjectId || !proposalId) { setLineItemImportError("Bid Board Project ID and Proposal ID are required."); return; }

    let rows: Record<string, unknown>[] = [];
    try { rows = parseLineItemImportRows(); } catch (e) { setLineItemImportError(e instanceof Error ? e.message : String(e)); return; }

    if (!window.confirm(`This will create ${rows.length} line item(s) in Procore. Continue?`)) return;

    setLineItemImportBusy(true);
    setLineItemImportError(null);
    setLineItemImportResult(null);
    try {
      // Resolve group names → IDs once before the loop
      const hasGroupNames = rows.some((r) => typeof r.group_name === "string" && (r.group_name as string).trim());
      const groupNameMap = hasGroupNames ? await fetchGroupNameMap(bidBoardProjectId, proposalId) : {};

      const results: Array<Record<string, unknown>> = [];
      for (let index = 0; index < rows.length; index++) {
        const resolvedRow = resolveGroupName(rows[index], groupNameMap);
        const payload = buildLineItemPayloadFromRow(resolvedRow);
        if (!payload.name || !(payload.name as string).trim()) {
          results.push({ index, ok: false, error: "Missing required field: name", payload });
          continue;
        }
        const payloadCostItem = payload.cost_item as Record<string, unknown> | undefined;
        const hasItemId = typeof payloadCostItem?.id === "string" && payloadCostItem.id.trim().length > 0;
        if (!hasItemId) {
          results.push({ index, ok: false, error: "Missing required field: cost_item.id (use ci_item_id or ci_itemId)", payload });
          continue;
        }
        const response = await fetch("/api/procore/estimating/proposal-line-items-create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bidBoardProjectId, proposalId, ...payload }),
        });
        const result = await response.json().catch(() => ({}));
        results.push({ index, ok: response.ok, status: response.status, payload, result });
      }
      const created = results.filter((r) => r.ok).length;
      setLineItemImportResult({ source: "estimating.create_line_item.bulk_from_rows", attempted: results.length, created, failed: results.length - created, results });
    } catch (err) {
      setLineItemImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setLineItemImportBusy(false);
    }
  };

  const handleCreateSingleLineItemFromJson = async () => {
    const bidBoardProjectId = lineItemImportBidBoardProjectId.trim();
    const proposalId = lineItemImportProposalId.trim();
    if (!bidBoardProjectId || !proposalId) {
      setSingleLineItemError("Bid Board Project ID and Proposal ID are required.");
      return;
    }

    let parsed: Record<string, unknown>;
    try {
      const value = JSON.parse(singleLineItemJson);
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("JSON must be an object payload.");
      }
      parsed = value as Record<string, unknown>;
    } catch (e) {
      setSingleLineItemError(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    setSingleLineItemBusy(true);
    setSingleLineItemError(null);
    setSingleLineItemResult(null);
    try {
      const response = await fetch("/api/procore/estimating/proposal-line-items-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bidBoardProjectId, proposalId, ...parsed }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setSingleLineItemError(result?.error ? `${result.error}${result?.details ? `: ${result.details}` : ""}` : `Create failed (${response.status}).`);
      }
      setSingleLineItemResult({ status: response.status, ok: response.ok, result });
    } catch (err) {
      setSingleLineItemError(err instanceof Error ? err.message : String(err));
    } finally {
      setSingleLineItemBusy(false);
    }
  };

  const handlePullLineItemPayloads = async () => {
    const bidBoardProjectId = lineItemImportBidBoardProjectId.trim();
    const proposalId = lineItemImportProposalId.trim();
    if (!bidBoardProjectId || !proposalId) {
      setLineItemPayloadPullError("Bid Board Project ID and Proposal ID are required.");
      return;
    }

    setLineItemPayloadPullBusy(true);
    setLineItemPayloadPullError(null);
    setLineItemPayloadPullResult(null);

    try {
      const response = await fetch("/api/procore/estimating/proposal-line-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bidBoardProjectId, proposalId, perPage: 200 }),
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setLineItemPayloadPullError(result?.error ? `${result.error}${result?.details ? `: ${result.details}` : ""}` : `Failed to pull payloads (${response.status}).`);
        return;
      }

      const lineItems = Array.isArray(result?.lineItems) ? result.lineItems : [];
      const qtyInspection = lineItems.map((item: any) => {
        const costItem = item?.cost_item && typeof item.cost_item === "object" ? item.cost_item : {};
        return {
          line_item_id: String(item?.id || item?.line_item_id || ""),
          name: String(item?.name || ""),
          count: item?.count ?? null,
          quantity: item?.quantity ?? null,
          qty: item?.qty ?? null,
          unit: typeof costItem?.unit === "string" ? costItem.unit : null,
          item_cost: item?.item_cost ?? null,
          labor_cost: item?.labor_cost ?? null,
        };
      });

      setLineItemPayloadPullResult({
        source: "estimating.proposal_line_items.pull_for_qty_review",
        bidBoardProjectId,
        proposalId,
        count: lineItems.length,
        qtyInspection,
        lineItems,
        raw: result?.raw ?? null,
      });
    } catch (err) {
      setLineItemPayloadPullError(err instanceof Error ? err.message : String(err));
    } finally {
      setLineItemPayloadPullBusy(false);
    }
  };

  const handleImportGroupsAndLayersFromRows = async () => {
    const bidBoardProjectId = lineItemImportBidBoardProjectId.trim();
    if (!bidBoardProjectId) {
      setLineItemImportViaImportError("Bid Board Project ID is required.");
      return;
    }

    let rows: Record<string, unknown>[] = [];
    try {
      rows = parseLineItemImportRows();
    } catch (e) {
      setLineItemImportViaImportError(e instanceof Error ? e.message : String(e));
      return;
    }

    if (!rows.length) {
      setLineItemImportViaImportError("No valid line item rows found.");
      return;
    }

    setLineItemImportViaImportBusy(true);
    setLineItemImportViaImportError(null);
    setLineItemImportViaImportResult(null);

    try {
      const readStr = (value: unknown): string => {
        if (typeof value === "string") return value.trim();
        if (typeof value === "number") return String(value);
        return "";
      };
      const readNum = (value: unknown): number | undefined => {
        if (typeof value === "number" && Number.isFinite(value)) return value;
        if (typeof value === "string" && value.trim() !== "") {
          const n = Number(value);
          if (Number.isFinite(n)) return n;
        }
        return undefined;
      };
      const readBool = (value: unknown): boolean | undefined => {
        if (typeof value === "boolean") return value;
        if (typeof value === "string") {
          const normalized = value.trim().toLowerCase();
          if (normalized === "true") return true;
          if (normalized === "false") return false;
        }
        return undefined;
      };
      const readCostCode = (value: unknown): string => {
        if (value && typeof value === "object") {
          const rec = value as Record<string, unknown>;
          return readStr(rec.code ?? rec.name ?? rec.value);
        }
        return readStr(value);
      };
      const pickValue = (row: Record<string, unknown>, keys: string[]): unknown => {
        for (const key of keys) {
          if (key in row) return row[key];
        }
        return undefined;
      };

      let groupNameMap: Record<string, string> = {};
      const proposalIdForLookup = lineItemImportProposalId.trim();
      const hasGroupNames = rows.some((r) => typeof r.group_name === "string" && (r.group_name as string).trim());
      if (hasGroupNames && proposalIdForLookup) {
        groupNameMap = await fetchGroupNameMap(bidBoardProjectId, proposalIdForLookup);
      }

      type GroupPayload = { name: string; layers: Array<Record<string, unknown>>; order: number };
      const groupsByKey = new Map<string, GroupPayload>();
      const rowDiagnostics: Array<Record<string, unknown>> = [];

      for (let index = 0; index < rows.length; index += 1) {
        const sourceRow = rows[index];
        const resolvedRow = resolveGroupName(sourceRow, groupNameMap);
        const payload = buildLineItemPayloadFromRow(resolvedRow);

        const groupName = readStr(
          pickValue(sourceRow, ["group.name", "group_name"])
        ) || "Imported Group";

        const layerName = readStr(
          pickValue(sourceRow, ["name", "layer.name"]) ?? payload.name
        );

        const costItemFromRow: Record<string, unknown> = {};
        const costItemStringFields = [
          "type",
          "based_on_item_id",
          "name",
          "description",
          "labor_time_unit",
          "manufacturer",
          "catalog_number",
          "url",
          "supplier",
          "unit",
          "notes",
          "id",
          "color",
          "symbol_id",
          "catalog_id",
        ];
        const costItemNumericFields = [
          "unit_cost",
          "unit_labor",
          "unit_labor_cost",
          "waste",
          "material_waste",
          "item_margin",
          "labor_margin",
          "unit_labor_rate",
          "delivery_unit",
        ];
        for (const field of costItemStringFields) {
          const value = readStr(pickValue(sourceRow, [`cost_item.${field}`]));
          if (value) costItemFromRow[field] = value;
        }
        for (const field of costItemNumericFields) {
          const value = readNum(pickValue(sourceRow, [`cost_item.${field}`]));
          if (value !== undefined) costItemFromRow[field] = value;
        }
        if (typeof costItemFromRow.labor_time_unit === "string") {
          const normalizedLaborTimeUnit = normalizeProcoreLaborTimeUnit(costItemFromRow.labor_time_unit);
          if (normalizedLaborTimeUnit) {
            costItemFromRow.labor_time_unit = normalizedLaborTimeUnit;
          } else {
            delete costItemFromRow.labor_time_unit;
          }
        }
        if (typeof costItemFromRow.unit === "string") {
          costItemFromRow.unit = normalizeProcoreCostItemUnit(costItemFromRow.unit);
        }
        const isUntaxed = readBool(pickValue(sourceRow, ["cost_item.is_untaxed"]));
        if (isUntaxed !== undefined) costItemFromRow.is_untaxed = isUntaxed;

        const payloadCostItemBase = payload.cost_item && typeof payload.cost_item === "object"
          ? (payload.cost_item as Record<string, unknown>)
          : {};
        const payloadCostItem = {
          ...payloadCostItemBase,
          ...costItemFromRow,
        };
        const normalizedCostItemType = typeof payloadCostItem.type === "string"
          ? payloadCostItem.type.trim().toLowerCase()
          : "";
        if (normalizedCostItemType === "labor") {
          delete payloadCostItem.unit_cost;
        }

        const hasName = layerName.length > 0;
        const hasCostItem = Object.keys(payloadCostItem).length > 0;
        const hasCostItemId = typeof payloadCostItem.id === "string" && payloadCostItem.id.trim().length > 0;

        if (!hasName || !hasCostItem || !hasCostItemId) {
          rowDiagnostics.push({
            index,
            skipped: true,
            reason: !hasName ? "Missing name" : !hasCostItem ? "Missing cost_item" : "Missing cost_item.id",
            payload: {
              ...payload,
              name: layerName || payload.name,
              cost_item: payloadCostItem,
            },
          });
          continue;
        }

        const groupKey = normalizeGroupNameKey(groupName) || `group-${index}`;
        if (!groupsByKey.has(groupKey)) {
          groupsByKey.set(groupKey, { name: groupName, layers: [], order: groupsByKey.size + 1 });
        }

        const group = groupsByKey.get(groupKey)!;
        const layer: Record<string, unknown> = {
          name: layerName,
          cost_item: payloadCostItem,
        };

        const groupId = readStr(pickValue(sourceRow, ["group_id", "layer.group_id"]) ?? payload.group_id);
        const tag = readStr(pickValue(sourceRow, ["tag", "layer.tag"]) ?? payload.tag);
        const layerId = readStr(pickValue(sourceRow, ["id", "layer.id"]));
        const layerType = readStr(pickValue(sourceRow, ["type", "layer.type"])) || "COUNT";
        const updatedAt = readStr(pickValue(sourceRow, ["updated_at", "layer.updated_at"]));

        const laborFactor = readNum(pickValue(sourceRow, ["labor_factor", "layer.labor_factor"]) ?? payload.labor_factor);
        const count = readNum(pickValue(sourceRow, ["count", "layer.count"]) ?? payload.count);
        const explicitItemCost = readNum(pickValue(sourceRow, ["layer.item_cost"]));
        const itemSales = readNum(pickValue(sourceRow, ["layer.item_sales"]));
        const explicitLaborCost = readNum(pickValue(sourceRow, ["layer.labor_cost", "labor_cost"]));
        const laborSales = readNum(pickValue(sourceRow, ["layer.labor_sales"]));
        const profit = readNum(pickValue(sourceRow, ["layer.profit"]));
        const payloadCostCode = readCostCode((payload as Record<string, unknown>).cost_code);
        const budgetCode = readCostCode(
          pickValue(sourceRow, ["budget_code", "cost_code.code", "cost_code", "layer.cost_code.code", "layer.cost_code"])
        ) || payloadCostCode;

        const costItemUnitLaborCost = readNum(payloadCostItem.unit_labor_cost);
        const costItemUnitLabor = readNum(payloadCostItem.unit_labor);
        const costItemUnitLaborRate = readNum(payloadCostItem.unit_labor_rate);
        const itemCost = normalizedCostItemType === "labor" ? undefined : explicitItemCost;
        const derivedLaborCost = count !== undefined
          ? (costItemUnitLaborCost !== undefined
            ? costItemUnitLaborCost * count
            : (costItemUnitLabor !== undefined && costItemUnitLaborRate !== undefined
              ? costItemUnitLabor * costItemUnitLaborRate * count
              : undefined))
          : undefined;
        const laborCost = explicitLaborCost ?? derivedLaborCost;

        if (groupId) layer.group_id = groupId;
        if (tag) layer.tag = tag;
        if (layerId) layer.id = layerId;
        if (layerType) layer.type = layerType;
        if (updatedAt) layer.updated_at = updatedAt;
        if (laborFactor !== undefined) layer.labor_factor = laborFactor;
        if (count !== undefined) layer.count = count;
        if (itemCost !== undefined) layer.item_cost = itemCost;
        if (itemSales !== undefined) layer.item_sales = itemSales;
        if (laborCost !== undefined) layer.labor_cost = laborCost;
        if (laborSales !== undefined) layer.labor_sales = laborSales;
        if (profit !== undefined) layer.profit = profit;
        if (budgetCode) layer.cost_code = { code: budgetCode };

        const pricingOverride: Record<string, unknown> = {};
        const poNumericFields = [
          "unit_material_cost",
          "material_margin",
          "unit_labor",
          "labor_factor",
          "unit_labor_rate",
          "unit_labor_cost",
          "labor_margin",
        ];
        for (const field of poNumericFields) {
          const value = readNum(
            pickValue(sourceRow, [`pricing_override.${field}`])
          );
          if (value !== undefined) pricingOverride[field] = value;
        }
        const poIsUntaxed = readBool(
          pickValue(sourceRow, ["pricing_override.is_untaxed"])
        );
        if (poIsUntaxed !== undefined) pricingOverride.is_untaxed = poIsUntaxed;

        const groupNotes = readStr(pickValue(sourceRow, ["group.notes"]));
        const groupMultiplier = readNum(pickValue(sourceRow, ["group.multiplier"]));
        const groupOrder = readNum(pickValue(sourceRow, ["group.order"]));
        if (groupNotes) (group as Record<string, unknown>).notes = groupNotes;
        if (groupMultiplier !== undefined) (group as Record<string, unknown>).multiplier = groupMultiplier;
        if (groupOrder !== undefined) group.order = groupOrder;
        if (Object.keys(pricingOverride).length > 0) {
          (group as Record<string, unknown>).pricing_override = pricingOverride;
        }

        group.layers.push(layer);
        rowDiagnostics.push({ index, skipped: false, group: group.name, layer });
      }

      const groups = Array.from(groupsByKey.values())
        .filter((g) => g.layers.length > 0)
        .map((g) => ({
          name: g.name,
          ...(typeof (g as any).notes === "string" ? { notes: (g as any).notes } : {}),
          ...(typeof (g as any).multiplier === "number" ? { multiplier: (g as any).multiplier } : {}),
          ...(typeof g.order === "number" ? { order: g.order } : {}),
          ...((g as any).pricing_override && typeof (g as any).pricing_override === "object"
            ? { pricing_override: (g as any).pricing_override }
            : {}),
          layers: g.layers,
        }));

      if (!groups.length) {
        setLineItemImportViaImportError("No valid layers could be built from rows. Ensure each row has at least name and cost_item.* fields.");
        return;
      }

      if (!window.confirm(`This will import ${groups.length} group(s) and ${rowDiagnostics.filter((r) => r.skipped === false).length} layer(s) via Bid Board import API. Continue?`)) {
        return;
      }

      const response = await fetch("/api/procore/estimating/import-line-item-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bidBoardProjectId, groups }),
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setLineItemImportViaImportError(result?.error ? `${result.error}${result?.details ? `: ${result.details}` : ""}` : `Import endpoint failed (${response.status}).`);
        setLineItemImportViaImportResult({
          source: "estimating.import_line_item_groups.ui_from_rows",
          bidBoardProjectId,
          attemptedGroupCount: groups.length,
          rowDiagnostics,
          responseStatus: response.status,
          responseBody: result,
        });
        return;
      }

      setLineItemImportViaImportResult({
        source: "estimating.import_line_item_groups.ui_from_rows",
        bidBoardProjectId,
        attemptedGroupCount: groups.length,
        attemptedLayerCount: rowDiagnostics.filter((r) => r.skipped === false).length,
        rowDiagnostics,
        requestGroups: groups,
        responseBody: result,
      });
    } catch (err) {
      setLineItemImportViaImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setLineItemImportViaImportBusy(false);
    }
  };

  const handleDirectCostWorkbookUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setDirectCostError(null);
    setDirectCostWorkbookSummary(null);
    try {
      const XLSX = await import("xlsx");
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: "array" });
      if (!workbook.SheetNames.length) throw new Error("Workbook has no sheets.");
      let selectedSheetName = workbook.SheetNames[0];
      let selectedRows: Record<string, unknown>[] = [];
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) continue;
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
        if (rows.length > 0) { selectedSheetName = sheetName; selectedRows = rows; break; }
      }
      if (selectedRows.length === 0) throw new Error("No row data found in workbook sheets.");
      setDirectCostRowsText(JSON.stringify(selectedRows, null, 2));
      setDirectCostWorkbookSummary(`${file.name}: loaded ${selectedRows.length} rows from sheet "${selectedSheetName}".`);
    } catch (err) {
      setDirectCostError(`Failed to parse workbook: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      event.target.value = "";
    }
  };

  const handleDirectCostSync = async () => {
    const projectId = directCostProjectId.trim();
    if (!projectId) { setDirectCostError("Procore Project ID is required."); return; }
    let updates: Record<string, unknown>[] = [];
    try {
      const parsed = JSON.parse(directCostRowsText);
      if (!Array.isArray(parsed)) throw new Error("Must be a JSON array.");
      updates = parsed.filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null);
    } catch (e) {
      setDirectCostError(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (updates.length === 0) { setDirectCostError("No valid update rows found."); return; }
    if (!window.confirm(`This will sync ${updates.length} direct cost line item(s) in Procore. Continue?`)) return;
    setDirectCostBusy(true);
    setDirectCostError(null);
    setDirectCostResult(null);
    try {
      const response = await fetch("/api/procore/direct-costs/line-items-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, updates }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setDirectCostError(result?.error ? `${result.error}${result?.details ? `: ${result.details}` : ""}` : `Sync failed (${response.status}).`);
        setDirectCostResult(result);
      } else {
        setDirectCostResult(result);
      }
    } catch (err) {
      setDirectCostError(err instanceof Error ? err.message : String(err));
    } finally {
      setDirectCostBusy(false);
    }
  };

  const getCount = (items: any) => {
    if (!items) return 0;
    if (Array.isArray(items)) return items.length;
    if (items.data && Array.isArray(items.data)) return items.data.length;
    if (items.entities && Array.isArray(items.entities)) return items.entities.length;
    if (items.projects && Array.isArray(items.projects)) return items.projects.length;
    return 0;
  };

  const renderData = (section: string, sectionData: any) => {
    if (!sectionData) return <p>No data</p>;
    if (sectionData.error) return <p className="text-red-500">{sectionData.error}</p>;

    // Unpack common wrapper objects from Procore v2.0
    let displayData = sectionData;
    if (!Array.isArray(sectionData) && sectionData && typeof sectionData === 'object') {
      if (Array.isArray(sectionData.data)) displayData = sectionData.data;
      else if (Array.isArray(sectionData.entities)) displayData = sectionData.entities;
      else if (Array.isArray(sectionData.projects)) displayData = sectionData.projects;
    }

    if (Array.isArray(displayData)) {
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse border border-gray-300">
            <thead className="bg-gray-200">
              <tr>
                {displayData[0] &&
                  Object.keys(displayData[0]).map((key) => (
                    <th key={key} className="border border-gray-300 p-2 text-left">
                      {key}
                    </th>
                  ))}
              </tr>
            </thead>
            <tbody>
              {displayData.slice(0, 10).map((item, idx) => (
                <tr key={idx} className="hover:bg-gray-50">
                  {Object.values(item).map((val, colIdx) => (
                    <td key={colIdx} className="border border-gray-300 p-2 text-sm">
                      {typeof val === "object" ? (
                        <span className="text-xs text-gray-400">Object</span>
                      ) : String(val)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {displayData.length > 10 && (
            <p className="text-sm text-gray-600 mt-2">
              Showing 10 of {displayData.length} items
            </p>
          )}
        </div>
      );
    }

    return (
      <pre className="bg-gray-100 p-4 rounded overflow-auto text-sm">
        {JSON.stringify(sectionData, null, 2)}
      </pre>
    );
  };

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-start mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Procore Integration Explorer</h1>
            <p className="text-gray-600">
              Connect to your Procore account and explore available data
            </p>
          </div>
        </div>

        {error && (
        <div className="mb-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative">
          <strong className="font-bold">Error: </strong>
          <span className="block sm:inline">{error}</span>
          {error.includes("expired") && (
            <button 
              onClick={() => window.location.href = '/api/auth/logout'}
              className="ml-4 underline font-bold"
            >
              Click here to Re-login
            </button>
          )}
        </div>
      )}

      {!isAuthenticated ? (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <h2 className="text-xl font-semibold mb-4">Authenticate with Procore</h2>
            <p className="text-gray-600 mb-6">
              Click below to log in with your Procore account
            </p>
            <button
              onClick={handleLogin}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded mb-4"
            >
              Login with Procore
            </button>
            <div className="mt-4 pt-4 border-t border-gray-100 italic text-xs text-gray-400">
               Note: This will redirect to your configured Procore Auth URL.
            </div>
          </div>
        ) : (
          <div>
            <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded mb-6">
              OK Authenticated with Procore
            </div>

            {syncResult && (
              <div className="bg-blue-100 border border-blue-400 text-blue-700 px-4 py-3 rounded mb-6">
                <strong>Sync Result:</strong> {syncResult.message}
              </div>
            )}

            {productivityResult && (
              <div className="bg-purple-100 border border-purple-400 text-purple-700 px-4 py-3 rounded mb-6">
                <strong>Productivity Sync:</strong> {productivityResult.message}
                <br/>
                <a href="/productivity" className="underline font-bold mt-2 inline-block">View Productivity Dashboard {"\u2192"}</a>
              </div>
            )}

            {productivityDebugResult && (
              <div className="bg-white rounded-lg shadow p-6 border-2 border-purple-500 mb-6">
                <h2 className="text-xl font-bold text-purple-900 mb-4">
                  🔍 Procore API Field Mapping
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="p-4 bg-purple-50 rounded border border-purple-200">
                    <h3 className="font-bold text-purple-900 mb-2">Employee Object Fields</h3>
                    <div className="text-sm font-mono">
                      {productivityDebugResult.employeeObjectKeys?.length > 0 ? (
                        <>
                          <div className="mb-3">
                            <strong>Keys:</strong> {productivityDebugResult.employeeObjectKeys.join(', ')}
                          </div>
                          <details>
                            <summary className="cursor-pointer font-semibold">View Full Sample</summary>
                            <pre className="mt-2 bg-white p-2 rounded text-xs border border-purple-200 overflow-auto max-h-64">
                              {JSON.stringify(productivityDebugResult.employeeObjectSample, null, 2)}
                            </pre>
                          </details>
                        </>
                      ) : (
                        <div className="text-gray-500 italic">No employee data found</div>
                      )}
                    </div>
                  </div>

                  <div className="p-4 bg-purple-50 rounded border border-purple-200">
                    <h3 className="font-bold text-purple-900 mb-2">Timecard Entry Object Fields</h3>
                    <div className="text-sm font-mono">
                      {productivityDebugResult.timecardObjectKeys?.length > 0 ? (
                        <>
                          <div className="mb-3">
                            <strong>Keys:</strong> {productivityDebugResult.timecardObjectKeys.join(', ')}
                          </div>
                          <details>
                            <summary className="cursor-pointer font-semibold">View Full Sample</summary>
                            <pre className="mt-2 bg-white p-2 rounded text-xs border border-purple-200 overflow-auto max-h-64">
                              {JSON.stringify(productivityDebugResult.timecardObjectSample, null, 2)}
                            </pre>
                          </details>
                        </>
                      ) : (
                        <div className="text-gray-500 italic">No timecard data found</div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-900">
                  <strong>Next Step:</strong> Use these field names to extract employee information from timecard entries.
                </div>
              </div>
            )}

            {error && (
              <div className={`px-4 py-3 rounded mb-6 border ${
                error.startsWith('OK') 
                  ? 'bg-green-100 border-green-400 text-green-700' 
                  : 'bg-red-100 border-red-400 text-red-700'
              }`}>
                {error.startsWith('OK') ? error : `Error: ${error}`}
              </div>
            )}

            {debugResult && debugResult.results && (
              <div className="bg-white rounded-lg shadow p-6 border-2 border-orange-500 mb-6">
                <h2 className="text-xl font-bold text-orange-900 mb-4">
                  🔍 Data Source Diagnostic Results
                </h2>
                <div className="mb-4 p-3 bg-orange-50 rounded">
                  <strong>Recommendation:</strong> {debugResult.recommendation}
                </div>
                <div className="text-sm overflow-x-auto">
                  <pre className="bg-gray-100 p-4 rounded text-xs">
                    {JSON.stringify(debugResult, null, 2)}
                  </pre>
                </div>
              </div>
            )}

            {debugResult && debugResult.logsCount !== undefined && (
              <div className="bg-white rounded-lg shadow p-6 border-2 border-indigo-500 mb-6">
                <h2 className="text-xl font-bold text-indigo-900 mb-4">
                  📊 Database Status
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                  <div className="bg-indigo-50 p-4 rounded">
                    <div className="text-sm text-indigo-700 font-semibold">Logs in Database</div>
                    <div className="text-2xl font-bold text-indigo-900">{debugResult.logsCount}</div>
                  </div>
                  <div className="bg-indigo-50 p-4 rounded">
                    <div className="text-sm text-indigo-700 font-semibold">Monthly Summaries</div>
                    <div className="text-2xl font-bold text-indigo-900">{debugResult.summariesCount}</div>
                  </div>
                  <div className="bg-indigo-50 p-4 rounded">
                    <div className="text-sm text-indigo-700 font-semibold">Total Hours</div>
                    <div className="text-2xl font-bold text-indigo-900">{debugResult.totalHours.toFixed(1)}</div>
                  </div>
                </div>
                <div className="text-sm overflow-x-auto">
                  <pre className="bg-gray-100 p-4 rounded text-xs">
                    {JSON.stringify({
                      message: debugResult.message,
                      byProject: debugResult.byProject,
                      sampleLogs: debugResult.sampleLogs,
                      firstSummary: debugResult.firstSummary
                    }, null, 2)}
                  </pre>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-6 gap-4 mb-6">
              <button
                onClick={handleExplore}
                disabled={loading || syncing || syncingProductivity || debugging || clearing || checkingDatabase}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-bold py-2 px-4 rounded text-sm"
              >
                {loading ? "Exploring..." : "Explore Available Data"}
              </button>
              
              <button
                onClick={handleSync}
                disabled={loading || syncing || syncingProductivity || debugging || clearing || checkingDatabase}
                className="bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-bold py-2 px-4 rounded text-sm"
              >
                {syncing ? "Syncing..." : "Sync Bid Board"}
              </button>

              <button
                onClick={handleClearProductivity}
                disabled={loading || syncing || syncingProductivity || debugging || clearing || checkingDatabase}
                className="bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white font-bold py-2 px-4 rounded text-sm"
              >
                {clearing ? "Clearing..." : "🗑️ Clear Old Data"}
              </button>

              <button
                onClick={handleSyncProductivity}
                disabled={loading || syncing || syncingProductivity || debugging || clearing || checkingDatabase}
                className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 text-white font-bold py-2 px-4 rounded text-sm"
              >
                {syncingProductivity ? "Syncing..." : "Sync Productivity"}
              </button>

              <button
                onClick={handleDebugProductivity}
                disabled={loading || syncing || syncingProductivity || debugging || clearing || checkingDatabase}
                className="bg-orange-600 hover:bg-orange-700 disabled:bg-gray-400 text-white font-bold py-2 px-4 rounded text-sm"
              >
                {debugging ? "Checking..." : "Check Data Sources"}
              </button>

              <button
                onClick={handleCheckDatabase}
                disabled={loading || syncing || syncingProductivity || debugging || clearing || checkingDatabase}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white font-bold py-2 px-4 rounded text-sm"
              >
                {checkingDatabase ? "Checking..." : "📊 Check Database"}
              </button>
            </div>

            <div className="bg-white rounded-lg shadow p-6 border-2 border-cyan-500 mb-6">
              <h2 className="text-xl font-bold text-cyan-900 mb-3">Create Productivity Log</h2>
              <p className="text-sm text-gray-600 mb-4">
                Create a single Procore productivity log directly via API. The <strong>line_item_id</strong> must come from an approved contract.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Project ID</label>
                  <input
                    type="text"
                    value={createProductivityProjectId}
                    onChange={(e) => setCreateProductivityProjectId(e.target.value)}
                    placeholder="e.g. 598134326278124"
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <label className="block text-sm font-semibold text-gray-700 mb-1">productivity_log JSON</label>
              <textarea
                value={createProductivityJson}
                onChange={(e) => setCreateProductivityJson(e.target.value)}
                className="w-full border border-gray-400 rounded px-3 py-2 text-sm leading-6 font-mono text-gray-900 bg-white h-48"
              />

              <div className="flex flex-wrap gap-3 mt-4">
                <button
                  onClick={handleCreateProductivityLog}
                  disabled={createProductivityBusy}
                  className="bg-cyan-600 hover:bg-cyan-700 disabled:bg-gray-400 text-white font-bold py-2 px-4 rounded text-sm"
                >
                  {createProductivityBusy ? "Creating..." : "Create Productivity Log"}
                </button>
              </div>

              {createProductivityError && (
                <div className="mt-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
                  <strong>Create Productivity Error:</strong> {createProductivityError}
                </div>
              )}

              {createProductivityResult && (
                <pre className="mt-4 bg-gray-50 border border-gray-300 text-gray-900 p-4 rounded overflow-auto text-sm leading-6 font-mono">
                  {JSON.stringify(createProductivityResult, null, 2)}
                </pre>
              )}
            </div>

            <div className="bg-white rounded-lg shadow p-6 border-2 border-sky-500 mb-6">
              <h2 className="text-xl font-bold text-sky-900 mb-3">Bid Board Project Import (Step 1)</h2>
              <p className="text-sm text-gray-600 mb-4">
                Upload a Bid Board project workbook, review the JSON rows, then create one Procore Bid Board project per row.
              </p>

              <div className="mb-4">
                <label className="block text-sm font-semibold text-gray-700 mb-1">Upload Project Workbook (.xlsx/.xls)</label>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleBidBoardProjectWorkbookUpload}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-white"
                />
                {projectImportWorkbookSummary && (
                  <p className="text-xs text-sky-700 mt-2">{projectImportWorkbookSummary}</p>
                )}
              </div>

              <label className="block text-sm font-semibold text-gray-700 mb-1">Project Rows JSON</label>
              <textarea
                value={projectImportRowsText}
                onChange={(e) => setProjectImportRowsText(e.target.value)}
                className="w-full border border-gray-400 rounded px-3 py-2 text-sm leading-6 font-mono text-gray-900 bg-white h-48"
                placeholder='[{"name":"Bid Board Template Example","status":"ESTIMATING","is_template":true}]'
              />

              <div className="flex flex-wrap gap-3 mt-4">
                <button
                  onClick={handlePreviewBidBoardProjectsFromRows}
                  disabled={projectImportBusy}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white font-bold py-2 px-4 rounded text-sm"
                >
                  {projectImportBusy ? "Working..." : "Preview Projects (Dry Run)"}
                </button>

                <button
                  onClick={handleCreateBidBoardProjectsFromRows}
                  disabled={projectImportBusy}
                  className="bg-sky-600 hover:bg-sky-700 disabled:bg-gray-400 text-white font-bold py-2 px-4 rounded text-sm"
                >
                  {projectImportBusy ? "Creating..." : "Create Projects From Rows"}
                </button>
              </div>

              {projectImportError && (
                <div className="mt-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
                  <strong>Project Import Error:</strong> {projectImportError}
                </div>
              )}

              {projectImportResult && (
                <div className="mt-4">
                  <div className="bg-sky-50 border border-sky-200 text-sky-900 px-4 py-3 rounded mb-3">
                    <strong>Project Import Result:</strong>{" "}
                    {projectImportResult.mode === "dry-run"
                      ? `Dry-run preview ready. Attempted ${projectImportResult.attempted}, Valid ${projectImportResult.valid}, Invalid ${projectImportResult.invalid}`
                      : `Attempted ${projectImportResult.attempted}, Created ${projectImportResult.created}, Failed ${projectImportResult.failed}`}
                  </div>
                  <pre className="bg-gray-50 border border-gray-300 text-gray-900 p-4 rounded overflow-auto text-sm leading-6 font-mono">
                    {JSON.stringify(projectImportResult, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            <div className="bg-white rounded-lg shadow p-6 border-2 border-violet-500 mb-6">
              <h2 className="text-xl font-bold text-violet-900 mb-3">Line Item Groups Import (Step 2)</h2>
              <p className="text-sm text-gray-600 mb-4">
                Upload the groups template, enter the Bid Board Project ID and Proposal ID, then create line item groups.{" "}
                <a href="/templates/procore-line-item-groups-template.xlsx" className="text-violet-700 underline text-xs" download>
                  Download template
                </a>
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Bid Board Project ID</label>
                  <input
                    type="text"
                    value={groupImportBidBoardProjectId}
                    onChange={(e) => setGroupImportBidBoardProjectId(e.target.value)}
                    placeholder="e.g. 562949955815658"
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Proposal ID</label>
                  <input
                    type="text"
                    value={groupImportProposalId}
                    onChange={(e) => setGroupImportProposalId(e.target.value)}
                    placeholder="e.g. 123456"
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-semibold text-gray-700 mb-1">Upload Groups Workbook (.xlsx/.xls)</label>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleGroupWorkbookUpload}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-white"
                />
                {groupImportWorkbookSummary && (
                  <p className="text-xs text-violet-700 mt-2">{groupImportWorkbookSummary}</p>
                )}
              </div>

              <label className="block text-sm font-semibold text-gray-700 mb-1">Group Rows JSON</label>
              <textarea
                value={groupImportRowsText}
                onChange={(e) => setGroupImportRowsText(e.target.value)}
                className="w-full border border-gray-400 rounded px-3 py-2 text-sm leading-6 font-mono text-gray-900 bg-white h-48"
                placeholder='[{"name":"Concrete - Sidewalk","multiplier":1,"unit_material_cost":45,"material_margin":0.1}]'
              />

              <div className="flex flex-wrap gap-3 mt-4">
                <button
                  onClick={handlePreviewGroupsFromRows}
                  disabled={groupImportBusy}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white font-bold py-2 px-4 rounded text-sm"
                >
                  {groupImportBusy ? "Working..." : "Preview Groups (Dry Run)"}
                </button>
                <button
                  onClick={handleCreateGroupsFromRows}
                  disabled={groupImportBusy}
                  className="bg-violet-600 hover:bg-violet-700 disabled:bg-gray-400 text-white font-bold py-2 px-4 rounded text-sm"
                >
                  {groupImportBusy ? "Creating..." : "Create Groups From Rows"}
                </button>
              </div>

              {groupImportError && (
                <div className="mt-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
                  <strong>Groups Import Error:</strong> {groupImportError}
                </div>
              )}

              {groupImportResult && (
                <div className="mt-4">
                  <div className="bg-violet-50 border border-violet-200 text-violet-900 px-4 py-3 rounded mb-3">
                    <strong>Groups Import Result:</strong>{" "}
                    {groupImportResult.mode === "dry-run"
                      ? `Dry-run preview ready. Attempted ${groupImportResult.attempted}, Valid ${groupImportResult.valid}, Invalid ${groupImportResult.invalid}`
                      : `Attempted ${groupImportResult.attempted}, Created ${groupImportResult.created}, Failed ${groupImportResult.failed}`}
                  </div>
                  <pre className="bg-gray-50 border border-gray-300 text-gray-900 p-4 rounded overflow-auto text-sm leading-6 font-mono">
                    {JSON.stringify(groupImportResult, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            <div className="bg-white rounded-lg shadow p-6 border-2 border-emerald-500 mb-6">
              <h2 className="text-xl font-bold text-emerald-900 mb-3">Line Items Import (Step 3)</h2>
              <p className="text-sm text-gray-600 mb-4">
                Upload the line items template, enter the Bid Board Project ID and Proposal ID, then create individual line items.{" "}
                <a href="/templates/procore-line-items-template.xlsx" className="text-emerald-700 underline text-xs" download>
                  Download template
                </a>
                {" "}|{" "}
                <a href="/templates/procore-import-groups-layers-template.json" className="text-amber-700 underline text-xs" download>
                  Groups + Layers JSON template
                </a>
                {" "}|{" "}
                <a href="/templates/procore-import-groups-layers-template.csv" className="text-amber-700 underline text-xs" download>
                  Groups + Layers CSV template
                </a>
              </p>
              <p className="text-xs text-gray-500 mb-4">
                Cost item fields use a <code className="bg-gray-100 px-1 rounded">ci_</code> prefix in the template (e.g. <code className="bg-gray-100 px-1 rounded">ci_type</code>, <code className="bg-gray-100 px-1 rounded">ci_unit_cost</code>). Only <strong>name</strong> is required.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Bid Board Project ID</label>
                  <input
                    type="text"
                    value={lineItemImportBidBoardProjectId}
                    onChange={(e) => setLineItemImportBidBoardProjectId(e.target.value)}
                    placeholder="e.g. 562949955815658"
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Proposal ID</label>
                  <input
                    type="text"
                    value={lineItemImportProposalId}
                    onChange={(e) => setLineItemImportProposalId(e.target.value)}
                    placeholder="e.g. 123456"
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-semibold text-gray-700 mb-1">Upload Line Items Workbook (.xlsx/.xls)</label>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleLineItemWorkbookUpload}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-white"
                />
                {lineItemImportWorkbookSummary && (
                  <p className="text-xs text-emerald-700 mt-2">{lineItemImportWorkbookSummary}</p>
                )}
              </div>

              <label className="block text-sm font-semibold text-gray-700 mb-1">Line Item Rows JSON</label>
              <textarea
                value={lineItemImportRowsText}
                onChange={(e) => setLineItemImportRowsText(e.target.value)}
                className="w-full border border-gray-400 rounded px-3 py-2 text-sm leading-6 font-mono text-gray-900 bg-white h-48"
                placeholder='[{"name":"Concrete - 4000 PSI","ci_type":"PART","ci_unit":"CY","ci_unit_cost":155}]'
              />

              <div className="mt-5 border border-emerald-200 rounded p-3 bg-emerald-50">
                <label className="block text-sm font-semibold text-emerald-900 mb-1">Create Single Line Item (Raw JSON)</label>
                <p className="text-xs text-emerald-800 mb-2">
                  Sends a single payload directly to <code className="bg-emerald-100 px-1 rounded">/api/procore/estimating/proposal-line-items-create</code>.
                </p>
                <textarea
                  value={singleLineItemJson}
                  onChange={(e) => setSingleLineItemJson(e.target.value)}
                  className="w-full border border-gray-400 rounded px-3 py-2 text-sm leading-6 font-mono text-gray-900 bg-white h-40"
                />
                <div className="mt-3 flex flex-wrap gap-3">
                  <button
                    onClick={handleCreateSingleLineItemFromJson}
                    disabled={singleLineItemBusy}
                    className="bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-400 text-white font-bold py-2 px-4 rounded text-sm"
                  >
                    {singleLineItemBusy ? "Creating..." : "Create Single Line Item (JSON)"}
                  </button>
                </div>
                {singleLineItemError && (
                  <div className="mt-3 bg-red-100 border border-red-400 text-red-700 px-3 py-2 rounded text-sm">
                    <strong>Single Create Error:</strong> {singleLineItemError}
                  </div>
                )}
                {singleLineItemResult && (
                  <pre className="mt-3 bg-gray-50 border border-gray-300 text-gray-900 p-4 rounded overflow-auto text-sm leading-6 font-mono">
                    {JSON.stringify(singleLineItemResult, null, 2)}
                  </pre>
                )}
              </div>

              <div className="flex flex-wrap gap-3 mt-4">
                <button
                  onClick={handlePreviewLineItemsFromRows}
                  disabled={lineItemImportBusy}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white font-bold py-2 px-4 rounded text-sm"
                >
                  {lineItemImportBusy ? "Working..." : "Preview Line Items (Dry Run)"}
                </button>
                <button
                  onClick={handleCreateLineItemsFromRows}
                  disabled={lineItemImportBusy}
                  className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-400 text-white font-bold py-2 px-4 rounded text-sm"
                >
                  {lineItemImportBusy ? "Creating..." : "Create Line Items From Rows"}
                </button>
                <button
                  onClick={handlePullLineItemPayloads}
                  disabled={lineItemPayloadPullBusy}
                  className="bg-slate-700 hover:bg-slate-800 disabled:bg-gray-400 text-white font-bold py-2 px-4 rounded text-sm"
                >
                  {lineItemPayloadPullBusy ? "Pulling..." : "Pull Existing Line Item Payloads"}
                </button>
                <button
                  onClick={handleImportGroupsAndLayersFromRows}
                  disabled={lineItemImportViaImportBusy}
                  className="bg-amber-600 hover:bg-amber-700 disabled:bg-gray-400 text-white font-bold py-2 px-4 rounded text-sm"
                >
                  {lineItemImportViaImportBusy ? "Importing..." : "Import Groups + Layers (Bid Board API)"}
                </button>
              </div>

              {lineItemImportError && (
                <div className="mt-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
                  <strong>Line Items Import Error:</strong> {lineItemImportError}
                </div>
              )}

              {lineItemImportResult && (
                <div className="mt-4">
                  <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 px-4 py-3 rounded mb-3">
                    <strong>Line Items Import Result:</strong>{" "}
                    {lineItemImportResult.mode === "dry-run"
                      ? `Dry-run preview ready. Attempted ${lineItemImportResult.attempted}, Valid ${lineItemImportResult.valid}, Invalid ${lineItemImportResult.invalid}`
                      : `Attempted ${lineItemImportResult.attempted}, Created ${lineItemImportResult.created}, Failed ${lineItemImportResult.failed}`}
                  </div>
                  <pre className="bg-gray-50 border border-gray-300 text-gray-900 p-4 rounded overflow-auto text-sm leading-6 font-mono">
                    {JSON.stringify(lineItemImportResult, null, 2)}
                  </pre>
                </div>
              )}

              {lineItemPayloadPullError && (
                <div className="mt-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
                  <strong>Pull Payloads Error:</strong> {lineItemPayloadPullError}
                </div>
              )}

              {lineItemPayloadPullResult && (
                <div className="mt-4">
                  <div className="bg-slate-50 border border-slate-200 text-slate-900 px-4 py-3 rounded mb-3">
                    <strong>Pulled Line Item Payloads:</strong> Found {lineItemPayloadPullResult.count} line item(s).
                  </div>
                  <pre className="bg-gray-50 border border-gray-300 text-gray-900 p-4 rounded overflow-auto text-sm leading-6 font-mono">
                    {JSON.stringify(lineItemPayloadPullResult, null, 2)}
                  </pre>
                </div>
              )}

              {lineItemImportViaImportError && (
                <div className="mt-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
                  <strong>Import Groups + Layers Error:</strong> {lineItemImportViaImportError}
                </div>
              )}

              {lineItemImportViaImportResult && (
                <div className="mt-4">
                  <div className="bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3 rounded mb-3">
                    <strong>Import Groups + Layers Result:</strong> Attempted {lineItemImportViaImportResult.attemptedGroupCount} group(s)
                    {typeof lineItemImportViaImportResult.attemptedLayerCount === "number" ? ` and ${lineItemImportViaImportResult.attemptedLayerCount} layer(s)` : ""}.
                  </div>
                  <pre className="bg-gray-50 border border-gray-300 text-gray-900 p-4 rounded overflow-auto text-sm leading-6 font-mono">
                    {JSON.stringify(lineItemImportViaImportResult, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            <div className="bg-white rounded-lg shadow p-6 border-2 border-rose-500 mb-6">
              <h2 className="text-xl font-bold text-rose-900 mb-3">Direct Cost Line Items Sync</h2>
              <p className="text-sm text-gray-600 mb-4">
                Sync (PATCH) direct cost line items to Procore using the <code className="bg-gray-100 px-1 rounded">direct_costs/line_items/sync</code> v1.0 endpoint.
                Upload an Excel file or paste a JSON array of update objects. Each row must include an <code className="bg-gray-100 px-1 rounded">id</code>.
              </p>

              <div className="mb-4">
                <label className="block text-sm font-semibold text-gray-700 mb-1">Procore Project ID</label>
                <input
                  type="text"
                  value={directCostProjectId}
                  onChange={(e) => setDirectCostProjectId(e.target.value)}
                  placeholder="e.g. 123456"
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                />
              </div>

              <div className="mb-4">
                <label className="block text-sm font-semibold text-gray-700 mb-1">Upload Workbook (.xlsx/.xls)</label>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleDirectCostWorkbookUpload}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-white"
                />
                {directCostWorkbookSummary && <p className="text-xs text-rose-700 mt-2">{directCostWorkbookSummary}</p>}
              </div>

              <div className="mb-4">
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Update Rows JSON
                </label>
                <p className="text-xs text-gray-500 mb-2">
                  Supported fields per row: <code className="bg-gray-100 px-1 rounded">id</code> (required), <code className="bg-gray-100 px-1 rounded">amount</code>, <code className="bg-gray-100 px-1 rounded">direct_cost_id</code>, <code className="bg-gray-100 px-1 rounded">cost_code_id</code>, <code className="bg-gray-100 px-1 rounded">wbs_code_id</code>, <code className="bg-gray-100 px-1 rounded">description</code>, <code className="bg-gray-100 px-1 rounded">extended_type</code>, <code className="bg-gray-100 px-1 rounded">quantity</code>, <code className="bg-gray-100 px-1 rounded">unit_cost</code>, <code className="bg-gray-100 px-1 rounded">uom</code>, <code className="bg-gray-100 px-1 rounded">line_item_type_id</code>, <code className="bg-gray-100 px-1 rounded">tax_code_id</code>, <code className="bg-gray-100 px-1 rounded">origin_data</code>, <code className="bg-gray-100 px-1 rounded">origin_id</code>.
                </p>
                <textarea
                  value={directCostRowsText}
                  onChange={(e) => setDirectCostRowsText(e.target.value)}
                  rows={8}
                  className="w-full border border-gray-400 rounded px-3 py-2 text-sm leading-6 font-mono text-gray-900 bg-white"
                  placeholder='[{"id": 123, "amount": 1000, "direct_cost_id": 456, "description": "Updated cost"}]'
                />
              </div>

              <div className="flex gap-3 mb-4">
                <button
                  onClick={handleDirectCostSync}
                  disabled={directCostBusy}
                  className="bg-rose-600 hover:bg-rose-700 disabled:bg-gray-400 text-white font-bold py-2 px-4 rounded text-sm"
                >
                  {directCostBusy ? "Syncing..." : "Sync Direct Cost Line Items"}
                </button>
              </div>

              {directCostError && (
                <div className="mt-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
                  <strong>Sync Error:</strong> {directCostError}
                </div>
              )}

              {directCostResult && (
                <div className="mt-4">
                  <div className={`px-4 py-3 rounded mb-3 border ${
                    directCostResult.success
                      ? "bg-rose-50 border-rose-200 text-rose-900"
                      : "bg-red-50 border-red-200 text-red-900"
                  }`}>
                    {directCostResult.success
                      ? <><strong>Sync Result:</strong> Updated {directCostResult.updatedCount} line item(s).</>
                      : <><strong>Sync failed.</strong> See details below.</>
                    }
                  </div>
                  <pre className="bg-gray-50 border border-gray-300 text-gray-900 p-4 rounded overflow-auto text-sm leading-6 font-mono">
                    {JSON.stringify(directCostResult, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            <div className="bg-white rounded-lg shadow p-6 border-2 border-teal-500 mb-6">
              <h2 className="text-xl font-bold text-teal-900 mb-3">Estimate Workbook Import</h2>
              <p className="text-sm text-gray-600 mb-4">
                Upload an Excel workbook or paste rows JSON, run a dry-run preview, then run live import to create proposal, groups, and line items.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Bid Board Project ID</label>
                  <input
                    type="text"
                    value={importBidBoardProjectId}
                    onChange={(e) => setImportBidBoardProjectId(e.target.value)}
                    placeholder="e.g. 11403839"
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Existing Proposal ID (Optional)</label>
                  <input
                    type="text"
                    value={importProposalId}
                    onChange={(e) => setImportProposalId(e.target.value)}
                    placeholder="Leave blank to create a proposal"
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">New Proposal Name</label>
                  <input
                    type="text"
                    value={importProposalName}
                    onChange={(e) => setImportProposalName(e.target.value)}
                    placeholder="Imported Estimate"
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                    disabled={Boolean(importProposalId.trim())}
                  />
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-semibold text-gray-700 mb-1">Upload Workbook (.xlsx/.xls)</label>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleWorkbookFileUpload}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-white"
                />
                {importWorkbookSummary && (
                  <p className="text-xs text-teal-700 mt-2">{importWorkbookSummary}</p>
                )}
              </div>

              <label className="block text-sm font-semibold text-gray-700 mb-1">Workbook Rows JSON</label>
              <textarea
                value={importRowsText}
                onChange={(e) => setImportRowsText(e.target.value)}
                className="w-full border border-gray-400 rounded px-3 py-2 text-sm leading-6 font-mono text-gray-900 bg-white h-48"
                placeholder='[{"Cost item":"Division A","Cost Code":"03-100","Quantity":1}]'
              />

              <div className="flex flex-wrap gap-3 mt-4">
                <button
                  onClick={() => handleEstimateWorkbookImport(true)}
                  disabled={importBusy}
                  className="bg-teal-600 hover:bg-teal-700 disabled:bg-gray-400 text-white font-bold py-2 px-4 rounded text-sm"
                >
                  {importBusy ? "Working..." : "Preview Import (Dry Run)"}
                </button>

                <button
                  onClick={() => handleEstimateWorkbookImport(false)}
                  disabled={importBusy}
                  className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-400 text-white font-bold py-2 px-4 rounded text-sm"
                >
                  {importBusy ? "Working..." : "Run Live Import"}
                </button>
              </div>

              {importError && (
                <div className="mt-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
                  <strong>Import Error:</strong> {importError}
                </div>
              )}

              {importResult && (
                <div className="mt-4">
                  <div className="bg-teal-50 border border-teal-200 text-teal-900 px-4 py-3 rounded mb-3">
                    <strong>Import Result:</strong> {importResult.mode === "dry-run" ? "Dry-run preview ready" : "Live import finished"}
                  </div>
                  <pre className="bg-gray-50 border border-gray-300 text-gray-900 p-4 rounded overflow-auto text-sm leading-6 font-mono">
                    {JSON.stringify(importResult, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            {debugResult && (
              <div className="bg-white rounded-lg shadow p-6 border-2 border-orange-500 mb-6">
                <h2 className="text-xl font-bold text-orange-900 mb-4">
                  🔍 Data Source Diagnostic Results
                </h2>
                <div className="mb-4 p-3 bg-orange-50 rounded">
                  <strong>Recommendation:</strong> {debugResult.recommendation}
                </div>
                <div className="text-sm overflow-x-auto">
                  <pre className="bg-gray-100 p-4 rounded text-xs">
                    {JSON.stringify(debugResult, null, 2)}
                  </pre>
                </div>
              </div>
            )}

            {data && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white rounded-lg shadow p-6">
                  <h2
                    className="text-lg font-semibold mb-4 cursor-pointer hover:text-blue-600"
                    onClick={() => setSelectedSection(selectedSection === "user" ? null : "user")}
                  >
                    👤 User Info
                  </h2>
                  {selectedSection === "user" && (
                    <div className="text-sm">
                      {renderData("user", data.user)}
                    </div>
                  )}
                </div>

                <div className="bg-white rounded-lg shadow p-6">
                  <h2
                    className="text-lg font-semibold mb-4 cursor-pointer hover:text-blue-600"
                    onClick={() =>
                      setSelectedSection(
                        selectedSection === "companies" ? null : "companies"
                      )
                    }
                  >
                    🏢 Companies ({getCount(data.companies)})
                  </h2>
                  {selectedSection === "companies" && (
                    <div className="text-sm max-h-96 overflow-y-auto">
                      {renderData("companies", data.companies)}
                    </div>
                  )}
                </div>

                <div className="bg-white rounded-lg shadow p-6">
                  <h2
                    className="text-lg font-semibold mb-4 cursor-pointer hover:text-blue-600"
                    onClick={() =>
                      setSelectedSection(
                        selectedSection === "projects" ? null : "projects"
                      )
                    }
                  >
                    📋 All Projects (Merged: {getCount(data.unifiedProjects)})
                  </h2>
                  {selectedSection === "projects" && (
                    <div className="text-sm max-h-96 overflow-y-auto">
                      <p className="text-xs text-gray-500 mb-2 italic">Combining Core Construction Projects and Bid Board Projects</p>
                      {renderData("projects", data.unifiedProjects)}
                    </div>
                  )}
                </div>

                <div className="bg-white rounded-lg shadow p-6">
                  <h2
                    className="text-lg font-semibold mb-4 cursor-pointer hover:text-blue-600"
                    onClick={() =>
                      setSelectedSection(
                        selectedSection === "vendors" ? null : "vendors"
                      )
                    }
                  >
                    🏭 Vendors ({getCount(data.vendors)})
                  </h2>
                  {selectedSection === "vendors" && (
                    <div className="text-sm max-h-96 overflow-y-auto">
                      {renderData("vendors", data.vendors)}
                    </div>
                  )}
                </div>

                <div className="bg-white rounded-lg shadow p-6">
                  <h2
                    className="text-lg font-semibold mb-4 cursor-pointer hover:text-blue-600"
                    onClick={() => setSelectedSection(selectedSection === "users" ? null : "users")
                    }
                  >
                    👥 Users ({getCount(data.users)})
                  </h2>
                  {selectedSection === "users" && (
                    <div className="text-sm max-h-96 overflow-y-auto">
                      {renderData("users", data.users)}
                    </div>
                  )}
                </div>

                <div className="bg-white rounded-lg shadow p-6">
                  <h2
                    className="text-lg font-semibold mb-4 cursor-pointer hover:text-blue-600"
                    onClick={() =>
                      setSelectedSection(
                        selectedSection === "bidboard" ? null : "bidboard"
                      )
                    }
                  >
                    💰 Bid Board ({getCount(data.bidBoardProjects)}) / Est ({getCount(data.estimatingProjects)})
                  </h2>
                  {selectedSection === "bidboard" && (
                    <div className="text-sm max-h-96 overflow-y-auto">
                      <h3 className="font-bold mb-2">Bid Board Projects:</h3>
                      {renderData("bidboard", data.bidBoardProjects)}
                      <h3 className="font-bold mt-4 mb-2">Estimating Projects:</h3>
                      {renderData("estimating", data.estimatingProjects)}
                    </div>
                  )}
                </div>

                <div className="bg-white rounded-lg shadow p-6">
                  <h2
                    className="text-lg font-semibold mb-4 cursor-pointer hover:text-blue-600"
                    onClick={() =>
                      setSelectedSection(
                        selectedSection === "bids" ? null : "bids"
                      )
                    }
                  >
                    💸 Bid Board v2.0 ({getCount(data.bidBoardV2)})
                  </h2>
                  {selectedSection === "bids" && (
                    <div className="text-sm max-h-96 overflow-y-auto">
                      <h3 className="font-bold mb-2">Bid Board Projects (v2):</h3>
                      {renderData("bidboardv2", data.bidBoardV2)}
                    </div>
                  )}
                </div>

                <div className="bg-white rounded-lg shadow p-6">
                  <h2
                    className="text-lg font-semibold mb-4 cursor-pointer hover:text-blue-600"
                    onClick={() =>
                      setSelectedSection(
                        selectedSection === "templates" ? null : "templates"
                      )
                    }
                  >
                    📑 Project Templates ({getCount(data.projectTemplates)})
                  </h2>
                  {selectedSection === "templates" && (
                    <div className="text-sm max-h-96 overflow-y-auto">
                      {renderData("templates", data.projectTemplates)}
                    </div>
                  )}
                </div>

                <div className="bg-white rounded-lg shadow p-6 md:col-span-2">
                  <h2
                    className="text-lg font-semibold mb-4 cursor-pointer hover:text-blue-600"
                    onClick={() =>
                      setSelectedSection(
                        selectedSection === "productivity" ? null : "productivity"
                      )
                    }
                  >
                    📈 Productivity Logs (Sample from {data.productivityLogs?.length || 0} Projects)
                  </h2>
                  {selectedSection === "productivity" && (
                    <div className="text-sm max-h-96 overflow-y-auto">
                      <p className="text-xs text-gray-500 mb-4 italic">
                        Productivity logs are project-specific. Showing data for a few sample projects from the list.
                      </p>
                      {data.productivityLogs?.map((item: any, idx: number) => (
                        <div key={idx} className="mb-6 border-b pb-4 last:border-0">
                          <h3 className="font-bold text-blue-800 mb-2">{item.projectName} (ID: {item.projectId})</h3>
                          {renderData(`prod_${item.projectId}`, item.logs)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {data.giantProductivity && (
                  <div className="bg-white rounded-lg shadow p-6 border-2 border-blue-500 md:col-span-2">
                    <h2 className="text-xl font-bold text-blue-900 mb-4">
                      🏗️ Giant #6582: Specific Productivity Data (Last 90 Days)
                    </h2>
                    <div className="text-sm overflow-x-auto">
                      {data.giantProductivity.data?.length > 0 ? (
                        renderData("giant", data.giantProductivity.data)
                      ) : (
                        <div className="p-4 bg-yellow-50 text-yellow-800 rounded">
                           Found project "{data.giantProductivity.name}" (ID: {data.giantProductivity.id}), but no specific <strong>Productivity Logs</strong> entries were found for this date range. 
                           <br/><br/>
                           Check the <strong>Manpower Logs</strong> above for this project to see general daily labor hours.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {data && (
              <div className="bg-white rounded-lg shadow p-6 mt-6">
                <h2 className="text-lg font-semibold mb-4">Raw JSON Response</h2>
                <details>
                  <summary className="cursor-pointer font-semibold hover:text-blue-600">
                    Click to expand
                  </summary>
                  <pre className="bg-gray-50 border border-gray-300 text-gray-900 p-4 rounded overflow-auto text-sm leading-6 font-mono mt-4">
                    {JSON.stringify(data, null, 2)}
                  </pre>
                </details>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
