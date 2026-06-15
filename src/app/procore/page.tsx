"use client";
import React, { useState, useEffect } from "react";
import { normalizeProcoreCostItemUnit, normalizeProcoreLaborTimeUnit } from "@/lib/procoreUnits";
import { PROCORE_PERMANENT_COST_TYPE_BY_CODE } from "@/lib/procorePermanentCostTypeLookup";

function csvCell(value: unknown): string {
  const text =
    value === null || value === undefined
      ? ""
      : typeof value === "string"
        ? value
        : typeof value === "number" || typeof value === "boolean"
          ? String(value)
          : JSON.stringify(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(filename: string, headers: string[], rows: unknown[][]) {
  const csv = [headers.map(csvCell).join(","), ...rows.map((row) => row.map(csvCell).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadTextFile(filename: string, content: string, mimeType = "text/plain;charset=utf-8;") {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}


interface EstimateConversionResponse {
  success?: boolean;
  error?: string;
  details?: string;
  detectedColumns?: {
    costCodeColumn?: string;
    itemIdColumn?: string;
  };
  rowsTotal?: number;
  rowsMatched?: number;
  rowsUnmatched?: number;
  convertedCsv?: string;
  unmatchedCsv?: string;
}

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

interface CompanyUserOption {
  id: string;
  party_id?: string | null;
  login: string | null;
  name: string | null;
  company_name: string | null;
  payload?: Record<string, unknown> | null;
}

interface ProductivityLineItemOption {
  line_item_id: number;
  description: string;
  uom: string;
  amount: number | null;
  quantity: number | null;
  contract_id: string;
  contract_type: "commitment_contract" | "work_order_contract" | "purchase_order_contract";
  contract_title: string;
  contract_number: string;
  contract_status: string;
}

function getProductivityLineItemKey(item: ProductivityLineItemOption): string {
  return `${item.contract_type}:${item.contract_id}:${item.line_item_id}`;
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
  const [createProductivityJson, setCreateProductivityJson] = useState('{\n  "date": "2026-06-08",\n  "line_item_id": 173890,\n  "notes": "Productivity 50% complete",\n  "quantity_delivered": 10,\n  "quantity_used": 4\n}');
  const [createProductivityBusy, setCreateProductivityBusy] = useState(false);
  const [createProductivityError, setCreateProductivityError] = useState<string | null>(null);
  const [createProductivityResult, setCreateProductivityResult] = useState<any>(null);
  const [createProductivityLineItemsBusy, setCreateProductivityLineItemsBusy] = useState(false);
  const [createProductivityLineItemsError, setCreateProductivityLineItemsError] = useState<string | null>(null);
  const [createProductivityLineItems, setCreateProductivityLineItems] = useState<ProductivityLineItemOption[]>([]);
  const [createProductivitySelectedLineItemKey, setCreateProductivitySelectedLineItemKey] = useState("");
  const [createProductivityLineItemsInfo, setCreateProductivityLineItemsInfo] = useState<string | null>(null);
  const [createProductivityLineItemsDebug, setCreateProductivityLineItemsDebug] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedSection, setSelectedSection] = useState<string | null>(null);
  const [restRunnerMethod, setRestRunnerMethod] = useState("GET");
  const [restRunnerPath, setRestRunnerPath] = useState("/rest/v1.3/companies/{company_id}/me");
  const [restRunnerCompanyIdOverride, setRestRunnerCompanyIdOverride] = useState("");
  const [restRunnerBodyText, setRestRunnerBodyText] = useState("{}");
  const [restRunnerBusy, setRestRunnerBusy] = useState(false);
  const [restRunnerError, setRestRunnerError] = useState<string | null>(null);
  const [restRunnerResult, setRestRunnerResult] = useState<any>(null);
  const [companyUsersBusy, setCompanyUsersBusy] = useState(false);
  const [companyUsersError, setCompanyUsersError] = useState<string | null>(null);
  const [companyUsersResult, setCompanyUsersResult] = useState<CompanyUserOption[]>([]);
  const [companyUsersSearch, setCompanyUsersSearch] = useState("");
  const [companyUsersSummary, setCompanyUsersSummary] = useState<string | null>(null);
  const [importBidBoardProjectId, setImportBidBoardProjectId] = useState("");
  const [importProposalName, setImportProposalName] = useState("Imported Estimate");
  const [importProposalId, setImportProposalId] = useState("");
  const [importRowsText, setImportRowsText] = useState("[]");
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importWorkbookSummary, setImportWorkbookSummary] = useState<string | null>(null);

  // CSV import for productivity logs
  type CsvLogRow = {
    date: string;
    quantity_delivered: number | undefined;
    notes: string | undefined;
    _csv_contract: string;
    _csv_line_item: string;
    line_item_id: number | null;
    _matched: boolean;
    _status?: "pending" | "success" | "error";
    _statusMessage?: string;
  };
  const [csvImportRows, setCsvImportRows] = useState<CsvLogRow[]>([]);
  const [csvImportError, setCsvImportError] = useState<string | null>(null);
  const [csvImportBusy, setCsvImportBusy] = useState(false);
  const [csvImportSummary, setCsvImportSummary] = useState<string | null>(null);
  const [csvImportResults, setCsvImportResults] = useState<{ success: number; failed: number } | null>(null);
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
  const [proposalShowProjectId, setProposalShowProjectId] = useState("");
  const [proposalShowBidBoardProjectId, setProposalShowBidBoardProjectId] = useState("");
  const [proposalShowProposalId, setProposalShowProposalId] = useState("");
  const [proposalShowBusy, setProposalShowBusy] = useState(false);
  const [proposalCsvBusy, setProposalCsvBusy] = useState(false);
  const [proposalShowError, setProposalShowError] = useState<string | null>(null);
  const [proposalShowResult, setProposalShowResult] = useState<any>(null);

  const [purchaseOrderContractProjectId, setPurchaseOrderContractProjectId] = useState("66005");
  const [purchaseOrderContractRunValidations, setPurchaseOrderContractRunValidations] = useState(false);
  const [purchaseOrderContractAttachmentsText, setPurchaseOrderContractAttachmentsText] = useState('[]');
  const [purchaseOrderContractJsonText, setPurchaseOrderContractJsonText] = useState(`{
  "accounting_method": "unit",
  "approval_letter_date": "2012-10-23",
  "bill_to_address": "Santa Claus Lane, Carpinteria, CA",
  "contract_date": "2012-10-23",
  "delivery_date": "2012-10-23",
  "description": "<p>3 tons of cement.</p>",
  "executed": false,
  "execution_date": "2012-10-23",
  "issued_on_date": "2012-10-23",
  "letter_of_intent_date": "2012-10-23",
  "origin_code": "OC-abc123",
  "origin_data": "OD-2398273424",
  "origin_id": 459247544,
  "number": "PO-17-1990-00001",
  "payment_terms": "Net 20",
  "private": false,
  "retainage_percent": "10",
  "returned_date": "2012-10-23",
  "ship_to_address": "1410 Harbor View Drive Newport Beach, CA 92663",
  "ship_via": "Acme Shipping",
  "status": "Processing",
  "title": "Initial cement order.",
  "custom_field_%{custom_field_definition_id}": "custom field value",
  "currency_exchange_rate": 1.5,
  "currency_iso_code": "USD"
}`);
  const [purchaseOrderContractBusy, setPurchaseOrderContractBusy] = useState(false);
  const [purchaseOrderContractError, setPurchaseOrderContractError] = useState<string | null>(null);
  const [purchaseOrderContractResult, setPurchaseOrderContractResult] = useState<any>(null);
  const [deletePurchaseOrderContractId, setDeletePurchaseOrderContractId] = useState("");
  const [deletePurchaseOrderContractBusy, setDeletePurchaseOrderContractBusy] = useState(false);
  const [deletePurchaseOrderContractError, setDeletePurchaseOrderContractError] = useState<string | null>(null);
  const [deletePurchaseOrderContractResult, setDeletePurchaseOrderContractResult] = useState<any>(null);
  type PurchaseOrderContractCsvRow = {
    contractLabel: string;
    vendorName: string;
    vendorId?: string;
    contractNumber: string;
    contractTitle: string;
    contractDate: string;
    rowCount: number;
    status: "pending" | "success" | "error";
    statusMessage?: string;
    payload: Record<string, unknown>;
  };
  const [purchaseOrderContractCsvRows, setPurchaseOrderContractCsvRows] = useState<PurchaseOrderContractCsvRow[]>([]);
  const [purchaseOrderContractCsvBusy, setPurchaseOrderContractCsvBusy] = useState(false);
  const [purchaseOrderContractCsvError, setPurchaseOrderContractCsvError] = useState<string | null>(null);
  const [purchaseOrderContractCsvSummary, setPurchaseOrderContractCsvSummary] = useState<string | null>(null);
  const [purchaseOrderContractCsvResults, setPurchaseOrderContractCsvResults] = useState<{ success: number; failed: number } | null>(null);
  const [purchaseOrderContractCsvAllowPrivate, setPurchaseOrderContractCsvAllowPrivate] = useState(false);
  const [purchaseOrderContractCsvAllowUnitAccounting, setPurchaseOrderContractCsvAllowUnitAccounting] = useState(false);
  type PurchaseOrderLineItemCsvRow = {
    projectId?: string;
    purchaseOrderContractId?: string;
    costCodeRaw: string;
    costType: string;
    mappedCostCode?: string;
    mappedCostType?: string;
    description: string;
    quantity: number;
    uom: string;
    unitPrice: number;
    amount: number;
    status: "pending" | "success" | "error";
    statusMessage?: string;
    payload: Record<string, unknown>;
  };
  type TimecardCsvResolvedRow = {
    rowNumber: number;
    source: Record<string, unknown>;
    payload: Record<string, unknown>;
    resolved: boolean;
    resolutionNotes: string[];
    resolvedPartyName: string;
    resolvedTimeTypeName: string;
    resolvedCostCodeName: string;
    status: "pending" | "success" | "error";
    statusMessage?: string;
  };
  const [purchaseOrderLineItemProjectId, setPurchaseOrderLineItemProjectId] = useState("66005");
  const [purchaseOrderLineItemContractId, setPurchaseOrderLineItemContractId] = useState("");
  const [purchaseOrderLineItemJsonText, setPurchaseOrderLineItemJsonText] = useState(`{
  "amount": "1000.0",
  "budget_line_item_id": 0,
  "cost_code_id": 0,
  "description": "Cleanup",
  "extended_type": "manual",
  "quantity": "20.0",
  "line_item_type_id": 0,
  "origin_data": "AC-1234",
  "origin_id": 55555,
  "unit_cost": "50.00",
  "uom": "Hours"
}`);
  const [purchaseOrderLineItemBusy, setPurchaseOrderLineItemBusy] = useState(false);
  const [purchaseOrderLineItemError, setPurchaseOrderLineItemError] = useState<string | null>(null);
  const [purchaseOrderLineItemResult, setPurchaseOrderLineItemResult] = useState<any>(null);
  const [purchaseOrderLineItemCsvRows, setPurchaseOrderLineItemCsvRows] = useState<PurchaseOrderLineItemCsvRow[]>([]);
  const [purchaseOrderLineItemCsvBusy, setPurchaseOrderLineItemCsvBusy] = useState(false);
  const [purchaseOrderLineItemCsvError, setPurchaseOrderLineItemCsvError] = useState<string | null>(null);
  const [purchaseOrderLineItemCsvSummary, setPurchaseOrderLineItemCsvSummary] = useState<string | null>(null);
  const [purchaseOrderLineItemCsvResults, setPurchaseOrderLineItemCsvResults] = useState<{ success: number; failed: number } | null>(null);
  const [purchaseOrderLineItemCsvDefaultTypeId, setPurchaseOrderLineItemCsvDefaultTypeId] = useState("");
  const [purchaseOrderLineItemCsvDefaultWbsId, setPurchaseOrderLineItemCsvDefaultWbsId] = useState("");
  const [purchaseOrderLineItemCsvDefaultBudgetLineItemId, setPurchaseOrderLineItemCsvDefaultBudgetLineItemId] = useState("");
  const [purchaseOrderLineItemMappingBusy, setPurchaseOrderLineItemMappingBusy] = useState(false);
  const [purchaseOrderLineItemMappingError, setPurchaseOrderLineItemMappingError] = useState<string | null>(null);
  const [purchaseOrderLineItemMappingSummary, setPurchaseOrderLineItemMappingSummary] = useState<string | null>(null);
  const [purchaseOrderLineItemMappingProfileBusy, setPurchaseOrderLineItemMappingProfileBusy] = useState(false);
  const [purchaseOrderLineItemMappingProfileError, setPurchaseOrderLineItemMappingProfileError] = useState<string | null>(null);
  const [purchaseOrderLineItemMappingProfileSummary, setPurchaseOrderLineItemMappingProfileSummary] = useState<string | null>(null);
  const [purchaseOrderLineItemCostCodeMap, setPurchaseOrderLineItemCostCodeMap] = useState<Record<string, string>>({});
  const [purchaseOrderLineItemCostTypeMap, setPurchaseOrderLineItemCostTypeMap] = useState<Record<string, string>>({});
  const [purchaseOrderLineItemCostTypeByCodeMap, setPurchaseOrderLineItemCostTypeByCodeMap] = useState<Record<string, string>>({});
  const [purchaseOrderLineItemWbsCodeMap, setPurchaseOrderLineItemWbsCodeMap] = useState<Record<string, number>>({});
  const [purchaseOrderLineItemRefsBusy, setPurchaseOrderLineItemRefsBusy] = useState(false);
  const [purchaseOrderLineItemRefsError, setPurchaseOrderLineItemRefsError] = useState<string | null>(null);
  const [purchaseOrderLineItemRefsSummary, setPurchaseOrderLineItemRefsSummary] = useState<string | null>(null);
  const [purchaseOrderLineItemCostCodes, setPurchaseOrderLineItemCostCodes] = useState<Array<{ id: number; fullCode: string; name: string }>>([]);
  const [purchaseOrderLineItemCostTypes, setPurchaseOrderLineItemCostTypes] = useState<Array<{ id: number; code: string; name: string }>>([]);
  const [timecardProjectId, setTimecardProjectId] = useState("598134326626273");
  const [timecardFallbackJsonText, setTimecardFallbackJsonText] = useState(`{
  "lunch_time": "60"
}`);
  const [timecardCsvRows, setTimecardCsvRows] = useState<TimecardCsvResolvedRow[]>([]);
  const [timecardCsvBusy, setTimecardCsvBusy] = useState(false);
  const [timecardCsvError, setTimecardCsvError] = useState<string | null>(null);
  const [timecardCsvSummary, setTimecardCsvSummary] = useState<string | null>(null);
  const [timecardCsvResults, setTimecardCsvResults] = useState<{ success: number; failed: number } | null>(null);
  const [timecardSyncBusy, setTimecardSyncBusy] = useState<"all" | "users" | "types" | "codes" | null>(null);
  const [timecardSyncMessage, setTimecardSyncMessage] = useState<string | null>(null);

  // Direct Cost Line Items Sync
  const [directCostProjectId, setDirectCostProjectId] = useState("");
  const [directCostRowsText, setDirectCostRowsText] = useState("[]");
  const [directCostBusy, setDirectCostBusy] = useState(false);
  const [directCostResult, setDirectCostResult] = useState<any>(null);
  const [directCostError, setDirectCostError] = useState<string | null>(null);
  const [directCostWorkbookSummary, setDirectCostWorkbookSummary] = useState<string | null>(null);

  // Estimate Key Conversion
  const [estimateConversionBusy, setEstimateConversionBusy] = useState(false);
  const [estimateConversionError, setEstimateConversionError] = useState<string | null>(null);
  const [estimateConversionResult, setEstimateConversionResult] = useState<EstimateConversionResponse | null>(null);
  const [estimateCsvFileName, setEstimateCsvFileName] = useState<string>("");
  const [estimateCsvText, setEstimateCsvText] = useState<string>("");
  const [crosswalkCsvFileName, setCrosswalkCsvFileName] = useState<string>("");
  const [crosswalkCsvText, setCrosswalkCsvText] = useState<string>("");
  const [estimateCostCodeColumn, setEstimateCostCodeColumn] = useState<string>("");
  const [estimateItemIdColumn, setEstimateItemIdColumn] = useState<string>("");

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

  const savePurchaseOrderLineItemMappingProfile = async (
    costCodeMap: Record<string, string>,
    costTypeMap: Record<string, string>,
    costTypeByCodeMap: Record<string, string>
  ) => {
    const response = await fetch("/api/procore/po-line-item-mappings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ costCodeMap, costTypeMap, costTypeByCodeMap }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result?.error || result?.details || `Save failed (${response.status}).`);
    }
    return result;
  };

  const handleLoadPurchaseOrderLineItemMappingProfile = async () => {
    setPurchaseOrderLineItemMappingProfileBusy(true);
    setPurchaseOrderLineItemMappingProfileError(null);
    setPurchaseOrderLineItemMappingProfileSummary(null);

    try {
      const response = await fetch("/api/procore/po-line-item-mappings", { method: "GET" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result?.error || result?.details || `Load failed (${response.status}).`);
      }

      const costCodeMap = (result?.costCodeMap || {}) as Record<string, string>;
      const costTypeMap = (result?.costTypeMap || {}) as Record<string, string>;
      const costTypeByCodeMap = (result?.costTypeByCodeMap || {}) as Record<string, string>;

      setPurchaseOrderLineItemCostCodeMap(costCodeMap);
      setPurchaseOrderLineItemCostTypeMap(costTypeMap);
      setPurchaseOrderLineItemCostTypeByCodeMap(costTypeByCodeMap);

      if (result?.exists) {
        setPurchaseOrderLineItemMappingProfileSummary(
          `Loaded saved mapping profile: ${Object.keys(costCodeMap).length} cost code, ${Object.keys(costTypeMap).length} global cost type, ${Object.keys(costTypeByCodeMap).length} code-specific cost type mapping(s).`
        );
      } else {
        setPurchaseOrderLineItemMappingProfileSummary("No saved mapping profile found yet.");
      }
    } catch (error) {
      setPurchaseOrderLineItemMappingProfileError(error instanceof Error ? error.message : String(error));
    } finally {
      setPurchaseOrderLineItemMappingProfileBusy(false);
    }
  };

  useEffect(() => {
    void handleLoadPurchaseOrderLineItemMappingProfile();
  }, []);

  const handleEstimateCsvUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setEstimateConversionError(null);
    setEstimateConversionResult(null);
    try {
      const text = await file.text();
      setEstimateCsvText(text);
      setEstimateCsvFileName(file.name);
    } catch (uploadErr) {
      const message = uploadErr instanceof Error ? uploadErr.message : String(uploadErr);
      setEstimateConversionError(`Failed to read estimate CSV: ${message}`);
    } finally {
      event.target.value = "";
    }
  };

  const handleCrosswalkCsvUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setEstimateConversionError(null);
    setEstimateConversionResult(null);
    try {
      const text = await file.text();
      setCrosswalkCsvText(text);
      setCrosswalkCsvFileName(file.name);
    } catch (uploadErr) {
      const message = uploadErr instanceof Error ? uploadErr.message : String(uploadErr);
      setEstimateConversionError(`Failed to read crosswalk CSV: ${message}`);
    } finally {
      event.target.value = "";
    }
  };

  const handleConvertEstimateCsv = async () => {
    if (!estimateCsvText.trim()) {
      setEstimateConversionError("Upload an estimate CSV first.");
      return;
    }
    setEstimateConversionBusy(true);
    setEstimateConversionError(null);
    setEstimateConversionResult(null);
    try {
      const response = await fetch("/api/procore/estimating/convert-estimate-crosswalk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          estimateCsv: estimateCsvText,
          crosswalkCsv: crosswalkCsvText || undefined,
          costCodeColumn: estimateCostCodeColumn.trim() || undefined,
          itemIdColumn: estimateItemIdColumn.trim() || undefined,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as EstimateConversionResponse;
      if (!response.ok || !result.success) {
        const details = result.details ? `: ${result.details}` : "";
        throw new Error(`${result.error || "Conversion failed"}${details}`);
      }
      setEstimateConversionResult(result);
      const baseName = (estimateCsvFileName || "estimate").replace(/\.csv$/i, "");
      if (result.convertedCsv) {
        downloadTextFile(`${baseName}_converted.csv`, result.convertedCsv, "text/csv;charset=utf-8;");
      }
      if (result.unmatchedCsv) {
        downloadTextFile(`${baseName}_unmatched.csv`, result.unmatchedCsv, "text/csv;charset=utf-8;");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setEstimateConversionError(message);
    } finally {
      setEstimateConversionBusy(false);
    }
  };

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

  const applyProductivityLineItemIdToJson = (lineItemId: number) => {
    try {
      const parsed = JSON.parse(createProductivityJson);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("JSON must be an object.");
      }
      const updated = {
        ...(parsed as Record<string, unknown>),
        line_item_id: lineItemId,
      };
      setCreateProductivityJson(JSON.stringify(updated, null, 2));
      setCreateProductivityError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCreateProductivityError(`Unable to update productivity_log JSON with line_item_id: ${message}`);
    }
  };

  // Parse the productivity log CSV client-side
  function parseProductivityLogCSV(content: string): CsvLogRow[] {
    const lines = content.split("\n");
    if (lines.length < 2) return [];
    const headerLine = lines[0];
    const headers = parseCsvLine(headerLine).map((h) => h.toLowerCase().trim());
    const rows: CsvLogRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      const values = parseCsvLine(line);
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => { row[h] = values[idx] || ""; });
      const date = (row["date"] || "").trim();
      const contract = (row["contract"] || "").trim();
      const lineItem = (row["line item"] || "").trim();
      if (!date || !contract || !lineItem) continue;
      const qd = parseFloat(row["quantity delivered"] || "0");
      const comments = (row["comments"] || "").trim();
      rows.push({
        date,
        quantity_delivered: qd > 0 ? qd : undefined,
        notes: comments || undefined,
        _csv_contract: contract,
        _csv_line_item: lineItem,
        line_item_id: null,
        _matched: false,
        _status: "pending",
      });
    }
    return rows;
  }

  function parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const next = line[i + 1];
      if (char === '"') {
        if (inQuotes && next === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  }

  // Split CSV into records while respecting quoted multiline cells.
  function parseCsvRecords(content: string): string[] {
    const records: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < content.length; i++) {
      const char = content[i];
      const next = content[i + 1];

      if (char === '"') {
        if (inQuotes && next === '"') {
          current += '""';
          i++;
        } else {
          current += char;
          inQuotes = !inQuotes;
        }
        continue;
      }

      if ((char === "\n" || char === "\r") && !inQuotes) {
        if (char === "\r" && next === "\n") i++;
        if (current.trim()) records.push(current);
        current = "";
        continue;
      }

      current += char;
    }

    if (current.trim()) records.push(current);
    return records;
  }

  const handleCsvFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCsvImportError(null);
    setCsvImportSummary(null);
    setCsvImportResults(null);
    setCsvImportRows([]);
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".csv")) {
      setCsvImportError("Please upload a .csv file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const rows = parseProductivityLogCSV(content);
        if (rows.length === 0) {
          setCsvImportError("No valid rows found. Check that the CSV has Date, Contract, and Line Item columns.");
          return;
        }
        // Auto-match against loaded line items
        const matched = autoMatchCsvRows(rows);
        setCsvImportRows(matched);
        const matchCount = matched.filter((r) => r._matched).length;
        setCsvImportSummary(
          `Loaded ${rows.length} row(s). ${matchCount} matched to Procore line items. ${rows.length - matchCount} unmatched ΓÇö load line items first or check contract names.`
        );
      } catch (err) {
        setCsvImportError(err instanceof Error ? err.message : "Failed to parse CSV.");
      }
    };
    reader.readAsText(file);
    // Reset input so the same file can be re-uploaded
    e.target.value = "";
  };

  const autoMatchCsvRows = (rows: CsvLogRow[]): CsvLogRow[] => {
    if (createProductivityLineItems.length === 0) return rows;

    const normalizeLoose = (value: string): string =>
      String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9#-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const extractLineNumberTokens = (value: string): string[] => {
      const normalized = normalizeLoose(value);
      const tokens = new Set<string>();
      const hashMatches = normalized.match(/#\d+/g) || [];
      for (const token of hashMatches) tokens.add(token);
      const numMatches = normalized.match(/\b\d+\b/g) || [];
      for (const token of numMatches) tokens.add(`#${token}`);
      return Array.from(tokens);
    };

    const extractContractNumber = (value: string): string => {
      const normalized = normalizeLoose(value);
      const match = normalized.match(/\b(?:po|wo|co|pc)-?\d+\b/i) || normalized.match(/\b\d{3,}\b/);
      if (!match) return "";
      const token = String(match[0] || "").toUpperCase().replace(/\s+/g, "");
      if (/^(PO|WO|CO|PC)-?\d+$/.test(token)) {
        return token.includes("-") ? token : `${token.slice(0, 2)}-${token.slice(2)}`;
      }
      return token;
    };

    const stripLineItemPrefix = (value: string): string =>
      normalizeLoose(value).replace(/^#\d+\s*-\s*/, "").trim();

    const tokenize = (value: string): string[] =>
      stripLineItemPrefix(value)
        .split(" ")
        .map((t) => t.trim())
        .filter((t) => t.length > 1);

    const tokenOverlap = (left: string, right: string): number => {
      const leftTokens = new Set(tokenize(left));
      const rightTokens = new Set(tokenize(right));
      if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

      let shared = 0;
      for (const token of leftTokens) {
        if (rightTokens.has(token)) shared += 1;
      }
      const denominator = Math.max(1, Math.min(leftTokens.size, rightTokens.size));
      return shared / denominator;
    };

    return rows.map((row) => {
      const csvContract = normalizeLoose(row._csv_contract);
      const csvLineItem = normalizeLoose(row._csv_line_item);
      const csvLineItemNoPrefix = stripLineItemPrefix(row._csv_line_item);
      const csvContractNumber = extractContractNumber(row._csv_contract);
      const csvLineNumbers = extractLineNumberTokens(row._csv_line_item);
      const csvLineItemNumericId = Number((csvLineItem.match(/\b\d{3,}\b/) || [""])[0]);

      let best: { item: ProductivityLineItemOption; score: number } | null = null;
      for (const item of createProductivityLineItems) {
        const contractFields = [item.contract_number, item.contract_title, item.contract_id]
          .map((v) => normalizeLoose(String(v || "")))
          .filter(Boolean);
        const itemDesc = normalizeLoose(item.description || "");
        const itemDescNoPrefix = stripLineItemPrefix(item.description || "");
        const itemContractNumber = extractContractNumber(`${item.contract_number || ""} ${item.contract_title || ""}`);

        const contractNumberMatch =
          !!csvContractNumber && !!itemContractNumber && csvContractNumber === itemContractNumber;
        const contractTextMatch = contractFields.some(
          (field) =>
            (csvContract && (field.includes(csvContract) || csvContract.includes(field))) ||
            (csvContract && field.startsWith(csvContract))
        );
        const contractMatch = contractNumberMatch || contractTextMatch;
        if (!contractMatch) continue;

        const lineIdMatch = Number.isFinite(csvLineItemNumericId) && csvLineItemNumericId > 0
          ? item.line_item_id === csvLineItemNumericId
          : false;
        const lineNumberMatch = csvLineNumbers.some((token) => itemDesc.includes(token));
        const lineTextMatch =
          (!!csvLineItem && (itemDesc.includes(csvLineItem) || csvLineItem.includes(itemDesc))) ||
          (!!csvLineItemNoPrefix &&
            (itemDescNoPrefix.includes(csvLineItemNoPrefix) || csvLineItemNoPrefix.includes(itemDescNoPrefix)));
        const lineTokenMatch = tokenOverlap(row._csv_line_item, item.description || "") >= 0.6;

        if (!lineIdMatch && !lineNumberMatch && !lineTextMatch && !lineTokenMatch) continue;

        const score =
          (contractNumberMatch ? 5 : contractTextMatch ? 3 : 0) +
          (lineIdMatch ? 4 : 0) +
          (lineNumberMatch ? 2 : 0) +
          (lineTextMatch ? 1 : 0) +
          (lineTokenMatch ? 1 : 0);

        if (!best || score > best.score) {
          best = { item, score };
        }
      }

      const found = best?.item;
      if (found) {
        return { ...row, line_item_id: found.line_item_id, _matched: true };
      }
      return row;
    });
  };

  const handleCsvBulkSubmit = async () => {
    const projectId = createProductivityProjectId.trim();
    if (!projectId) {
      setCsvImportError("Project ID is required.");
      return;
    }
    const submittable = csvImportRows.filter((r) => r._matched && r.line_item_id !== null);
    if (submittable.length === 0) {
      setCsvImportError("No matched rows to submit. Load approved line items first.");
      return;
    }
    setCsvImportBusy(true);
    setCsvImportError(null);
    setCsvImportResults(null);
    let success = 0;
    let failed = 0;
    const updatedRows = [...csvImportRows];
    for (let i = 0; i < updatedRows.length; i++) {
      const row = updatedRows[i];
      if (!row._matched || row.line_item_id === null) continue;
      const payload: Record<string, unknown> = {
        date: row.date,
        line_item_id: row.line_item_id,
      };
      if (row.quantity_delivered !== undefined) payload.quantity_delivered = row.quantity_delivered;
      if (row.notes) payload.notes = row.notes;
      try {
        const response = await fetch("/api/procore/productivity-logs/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project_id: projectId, productivity_log: payload }),
        });
        const result = await response.json().catch(() => ({}));
        if (response.ok) {
          updatedRows[i] = { ...row, _status: "success", _statusMessage: `ID ${result?.data?.id ?? "OK"}` };
          success++;
        } else {
          const msg = result?.details || result?.error || `HTTP ${response.status}`;
          updatedRows[i] = { ...row, _status: "error", _statusMessage: msg };
          failed++;
        }
      } catch (err) {
        updatedRows[i] = { ...row, _status: "error", _statusMessage: err instanceof Error ? err.message : String(err) };
        failed++;
      }
      setCsvImportRows([...updatedRows]);
    }
    setCsvImportBusy(false);
    setCsvImportResults({ success, failed });
  };

  const handleLoadValidProductivityLineItems = async () => {
    const projectId = createProductivityProjectId.trim();
    if (!projectId) {
      setCreateProductivityLineItemsError("Project ID is required before loading line items.");
      return;
    }

    setCreateProductivityLineItemsBusy(true);
    setCreateProductivityLineItemsError(null);
    setCreateProductivityLineItemsInfo(null);
    setCreateProductivityLineItems([]);
    setCreateProductivitySelectedLineItemKey("");
    setCreateProductivityLineItemsDebug(null);

    try {
      const response = await fetch(
        `/api/procore/productivity-logs/valid-line-items?projectId=${encodeURIComponent(projectId)}`,
        { method: "GET" }
      );
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        const message = result?.error
          ? `${result.error}${result?.details ? `: ${result.details}` : ""}`
          : `Load failed (${response.status}).`;
        setCreateProductivityLineItemsError(message);
        return;
      }

      const items = Array.isArray(result?.items) ? (result.items as ProductivityLineItemOption[]) : [];
      setCreateProductivityLineItems(items);

      const approvedCommitmentContracts = Number(result?.counts?.approvedCommitmentContracts ?? 0);
      const approvedWorkOrderContracts = Number(result?.counts?.approvedWorkOrderContracts ?? 0);
      const approvedPurchaseOrderContracts = Number(result?.counts?.approvedPurchaseOrderContracts ?? 0);
      const statusSummary = `Found ${items.length} line item(s) from ${approvedCommitmentContracts} approved commitment, ${approvedWorkOrderContracts} approved WO, and ${approvedPurchaseOrderContracts} approved PO contract(s).`;
      setCreateProductivityLineItemsInfo(statusSummary);
      setCreateProductivityLineItemsDebug(result?.debug || null);

      if (items.length > 0) {
        const firstKey = getProductivityLineItemKey(items[0]);
        setCreateProductivitySelectedLineItemKey(firstKey);
        applyProductivityLineItemIdToJson(items[0].line_item_id);
      } else {
        setCreateProductivityLineItemsError(
          "No approved contract line items were returned for this project."
        );
      }
    } catch (error) {
      setCreateProductivityLineItemsError(error instanceof Error ? error.message : String(error));
    } finally {
      setCreateProductivityLineItemsBusy(false);
    }
  };

  const handleCreatePurchaseOrderContract = async () => {
    const projectId = purchaseOrderContractProjectId.trim();
    if (!projectId) {
      setPurchaseOrderContractError("Project ID is required.");
      return;
    }

    let purchaseOrderContractPayload: Record<string, unknown>;
    try {
      const parsed = JSON.parse(purchaseOrderContractJsonText);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("JSON must be an object.");
      }
      purchaseOrderContractPayload = parsed as Record<string, unknown>;
    } catch (e) {
      setPurchaseOrderContractError(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    let attachments: unknown[] | undefined;
    if (purchaseOrderContractAttachmentsText.trim()) {
      try {
        const parsedAttachments = JSON.parse(purchaseOrderContractAttachmentsText);
        if (!Array.isArray(parsedAttachments)) {
          throw new Error("Attachments must be a JSON array.");
        }
        attachments = parsedAttachments;
      } catch (e) {
        setPurchaseOrderContractError(`Invalid attachments JSON: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
    }

    setPurchaseOrderContractBusy(true);
    setPurchaseOrderContractError(null);
    setPurchaseOrderContractResult(null);
    try {
      const response = await fetch("/api/procore/purchase-order-contracts/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          attachments,
          purchase_order_contract: purchaseOrderContractPayload,
          run_configurable_validations: purchaseOrderContractRunValidations,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setPurchaseOrderContractError(
          result?.details
            ? `${result.error}: ${result.details}`
            : result?.error || `Create failed (${response.status}).`
        );
      }
      setPurchaseOrderContractResult({ status: response.status, ok: response.ok, result });
    } catch (err) {
      setPurchaseOrderContractError(err instanceof Error ? err.message : String(err));
    } finally {
      setPurchaseOrderContractBusy(false);
    }
  };

  const handleDeletePurchaseOrderContract = async () => {
    const projectId = purchaseOrderContractProjectId.trim();
    const contractId = deletePurchaseOrderContractId.trim();

    if (!projectId) {
      setDeletePurchaseOrderContractError("Project ID is required.");
      return;
    }
    if (!contractId) {
      setDeletePurchaseOrderContractError("Commitment Contract ID is required.");
      return;
    }

    const okToDelete = window.confirm(
      `Delete commitment contract ${contractId} from project ${projectId}? This cannot be undone.`
    );
    if (!okToDelete) return;

    setDeletePurchaseOrderContractBusy(true);
    setDeletePurchaseOrderContractError(null);
    setDeletePurchaseOrderContractResult(null);

    try {
      const response = await fetch("/api/procore/rest-runner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: "DELETE",
          path: `/rest/v2.0/companies/{company_id}/projects/${encodeURIComponent(projectId)}/commitment_contracts/${encodeURIComponent(contractId)}`,
        }),
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setDeletePurchaseOrderContractError(
          result?.details
            ? `${result?.error || "Delete failed"}: ${result.details}`
            : result?.error || `Delete failed (${response.status}).`
        );
      }
      setDeletePurchaseOrderContractResult({ status: response.status, ok: response.ok, result });
    } catch (error) {
      setDeletePurchaseOrderContractError(error instanceof Error ? error.message : String(error));
    } finally {
      setDeletePurchaseOrderContractBusy(false);
    }
  };

  const handleRunRestCommand = async () => {
    const path = restRunnerPath.trim();
    if (!path) {
      setRestRunnerError("Path is required (example: /rest/v1.3/companies/{company_id}/me).");
      return;
    }

    const method = restRunnerMethod.toUpperCase();
    let parsedBody: unknown = undefined;

    if (method !== "GET" && method !== "DELETE") {
      const token = restRunnerBodyText.trim();
      if (token) {
        try {
          parsedBody = JSON.parse(token);
        } catch (e) {
          setRestRunnerError(`Invalid JSON body: ${e instanceof Error ? e.message : String(e)}`);
          return;
        }
      }
    }

    setRestRunnerBusy(true);
    setRestRunnerError(null);
    setRestRunnerResult(null);

    try {
      const response = await fetch("/api/procore/rest-runner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method,
          path,
          companyId: restRunnerCompanyIdOverride.trim() || undefined,
          body: parsedBody,
        }),
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setRestRunnerError(
          result?.details
            ? `${result?.error || "Request failed"}: ${result.details}`
            : result?.error || `Request failed (${response.status}).`
        );
      }
      setRestRunnerResult({ status: response.status, ok: response.ok, result });
    } catch (error) {
      setRestRunnerError(error instanceof Error ? error.message : String(error));
    } finally {
      setRestRunnerBusy(false);
    }
  };

  const handleLoadCompanyUsers = async () => {
    setCompanyUsersBusy(true);
    setCompanyUsersError(null);
    setCompanyUsersSummary(null);

    try {
      const loadUsers = async () => {
        const projectId = timecardProjectId.trim();
        const response = await fetch("/api/procore/company-users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            page: 1,
            perPage: 250,
            search: companyUsersSearch.trim() || undefined,
            projectId: projectId || undefined,
          }),
        });

        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(result?.details || result?.error || `Load failed (${response.status}).`);
        }

        return result;
      };

      let result = await loadUsers();
      let data = Array.isArray(result?.data) ? (result.data as CompanyUserOption[]) : [];

      if (data.length === 0 && !companyUsersSearch.trim()) {
        const syncResponse = await fetch("/api/procore/sync/company-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

        const syncResult = await syncResponse.json().catch(() => ({}));
        if (!syncResponse.ok) {
          throw new Error(syncResult?.details || syncResult?.error || `Sync failed (${syncResponse.status}).`);
        }

        result = await loadUsers();
        data = Array.isArray(result?.data) ? (result.data as CompanyUserOption[]) : [];

        setCompanyUsersSummary(
          `Cache was empty. Synced company users and loaded ${data.length} user(s)${result?.syncedAt ? `; synced at ${result.syncedAt}` : ""}.`
        );
      } else {
        setCompanyUsersSummary(
          `Loaded ${data.length} user(s) from cached company users${result?.syncedAt ? `; synced at ${result.syncedAt}` : ""}.`
        );
      }

      setCompanyUsersResult(data);
    } catch (error) {
      setCompanyUsersError(error instanceof Error ? error.message : String(error));
    } finally {
      setCompanyUsersBusy(false);
    }
  };

  function parseShortDateToIso(value: string): string | undefined {
    const token = value.trim();
    const isoToken = token.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoToken) {
      return `${isoToken[1]}-${isoToken[2]}-${isoToken[3]}`;
    }
    const match = token.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (!match) return undefined;
    const month = Number(match[1]);
    const day = Number(match[2]);
    let year = Number(match[3]);
    if (year < 100) year += 2000;
    if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
    return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day
      .toString()
      .padStart(2, "0")}`;
  }

  function parseContractLabel(value: string): { number: string; title: string } {
    const raw = value.trim();
    const match = raw.match(/^([A-Za-z]+-\d+)\s*-\s*(.+)$/);
    if (!match) {
      return {
        number: raw || "UNSPECIFIED",
        title: raw || "Imported Purchase Order Contract",
      };
    }
    return { number: match[1].trim(), title: match[2].trim() };
  }

  function parseYesNoBoolean(value: string): boolean | undefined {
    const token = value.trim().toLowerCase();
    if (!token) return undefined;
    if (["yes", "true", "y", "1"].includes(token)) return true;
    if (["no", "false", "n", "0"].includes(token)) return false;
    return undefined;
  }

  function mapCommitmentTypeFromCsv(value: string): string | undefined {
    const token = value.trim().toLowerCase();
    if (!token) return undefined;
    if (token.includes("work order")) return "WorkOrderContract";
    if (token.includes("purchase order")) return "PurchaseOrderContract";
    return undefined;
  }

  function normalizeAccountingMethod(value: string): "amount" | "unit" | undefined {
    const token = value.trim().toLowerCase();
    if (!token) return undefined;
    if (token === "amount") return "amount";
    if (token === "unit") return "unit";
    return undefined;
  }

  function parseTimecardCsvRows(content: string): Record<string, unknown>[] {
    const lines = parseCsvRecords(content);
    if (lines.length < 2) return [];

    const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase().trim());
    const idxDate = headers.indexOf("date");
    const idxEmployeeName = headers.indexOf("employee name");
    const idxEmployeeId = headers.indexOf("employee id");
    const idxProjectName = headers.indexOf("project name");
    const idxProjectNumber = headers.indexOf("project number");
    const idxDescription = headers.indexOf("description");
    const idxCostCodeLongName = headers.indexOf("cost code long name");
    const idxBillable = headers.indexOf("billable");
    const idxHours = headers.indexOf("hours");
    const idxTimeType = headers.indexOf("formatted time type");
    const idxCostCodeLongNumber = headers.indexOf("cost code long number");
    const idxCostCodeName = headers.indexOf("cost code name");
    const idxClassification = headers.indexOf("classification");

    if (idxDate < 0 || idxEmployeeName < 0 || idxHours < 0) {
      throw new Error("CSV must contain Date, Employee Name, and Hours columns.");
    }

    const rows: Record<string, unknown>[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = parseCsvLine(lines[i]);
      const date = idxDate >= 0 ? (values[idxDate] || "").trim() : "";
      const employeeName = idxEmployeeName >= 0 ? (values[idxEmployeeName] || "").trim() : "";
      const hours = idxHours >= 0 ? (values[idxHours] || "").trim() : "";
      if (!date && !employeeName && !hours) continue;

      rows.push({
        date: parseShortDateToIso(date) || date,
        employeeName,
        employeeId: idxEmployeeId >= 0 ? (values[idxEmployeeId] || "").trim() : "",
        projectName: idxProjectName >= 0 ? (values[idxProjectName] || "").trim() : "",
        projectNumber: idxProjectNumber >= 0 ? (values[idxProjectNumber] || "").trim() : "",
        description: idxDescription >= 0 ? (values[idxDescription] || "").trim() : "",
        costCodeLongName: idxCostCodeLongName >= 0 ? (values[idxCostCodeLongName] || "").trim() : "",
        billable: idxBillable >= 0 ? (values[idxBillable] || "").trim() : "",
        hours,
        timeTypeName: idxTimeType >= 0 ? (values[idxTimeType] || "").trim() : "",
        costCodeLongNumber: idxCostCodeLongNumber >= 0 ? (values[idxCostCodeLongNumber] || "").trim() : "",
        costCodeName: idxCostCodeName >= 0 ? (values[idxCostCodeName] || "").trim() : "",
        classification: idxClassification >= 0 ? (values[idxClassification] || "").trim() : "",
      });
    }

    return rows;
  }

  function mergeTimecardFallbackPayload(payload: Record<string, unknown>, fallback: Record<string, unknown>) {
    const merged: Record<string, unknown> = { ...payload };
    for (const [key, value] of Object.entries(fallback)) {
      if (merged[key] === undefined || merged[key] === null || merged[key] === "") {
        merged[key] = value;
      }
    }
    return merged;
  }

  const handleTimecardCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const projectId = timecardProjectId.trim();
    setTimecardCsvError(null);
    setTimecardCsvSummary(null);
    setTimecardCsvResults(null);
    setTimecardCsvRows([]);

    if (!projectId) {
      setTimecardCsvError("Project ID is required before uploading a timecard CSV.");
      e.target.value = "";
      return;
    }

    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setTimecardCsvError("Please upload a .csv file.");
      e.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const content = String(event.target?.result || "");
        const parsedRows = parseTimecardCsvRows(content);
        if (parsedRows.length === 0) {
          setTimecardCsvError("No rows were parsed from the CSV.");
          return;
        }

        setTimecardCsvBusy(true);
        const response = await fetch("/api/procore/timecard-entries/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, rows: parsedRows }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(result?.details || result?.error || `Resolve failed (${response.status}).`);
        }

        const resolvedRows: TimecardCsvResolvedRow[] = Array.isArray(result?.rows)
          ? (result.rows as Omit<TimecardCsvResolvedRow, "status">[]).map((row) => ({
              ...row,
              status: row.resolved ? ("pending" as const) : ("error" as const),
              statusMessage: row.resolved ? undefined : row.resolutionNotes.join(" "),
            }))
          : [];

        const resolvedCount = resolvedRows.filter((row) => row.resolved).length;
        setTimecardCsvRows(resolvedRows);
        setTimecardCsvSummary(
          `${file.name}: prepared ${resolvedRows.length} row(s); ${resolvedCount} fully resolved, ${resolvedRows.length - resolvedCount} need attention.`
        );
      } catch (error) {
        setTimecardCsvError(error instanceof Error ? error.message : String(error));
      } finally {
        setTimecardCsvBusy(false);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleSyncTimecardLookups = async (kind: "all" | "users" | "types" | "codes") => {
    const projectId = timecardProjectId.trim();
    if ((kind === "types" || kind === "codes") && !projectId) {
      setTimecardCsvError("Project ID is required before syncing time types or cost codes.");
      return;
    }

    setTimecardSyncBusy(kind);
    setTimecardSyncMessage(null);
    setTimecardCsvError(null);

    try {
      const runSync = async (syncKind: "users" | "types" | "codes") => {
        let response: Response;
        if (syncKind === "users") {
          response = await fetch("/api/procore/sync/company-users", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });
        } else if (syncKind === "types") {
          response = await fetch("/api/procore/sync/timecard-time-types", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ maxProjects: 0, concurrency: 4, persist: true }),
          });
        } else {
          response = await fetch("/api/procore/sync/cost-codes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId, perPage: 100 }),
          });
        }

        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(result?.details || result?.error || `Sync failed (${response.status}).`);
        }

        return result;
      };

      if (kind === "all") {
        const usersResult = await runSync("users");
        const typesResult = await runSync("types");
        const codesResult = await runSync("codes");
        setTimecardSyncMessage(
          `Synced all lookup data: ${usersResult?.totalUpserted ?? 0} user(s), ${typesResult?.totalTypesSaved ?? typesResult?.totalTypesFetched ?? 0} time type(s), ${codesResult?.totalFetched ?? 0} cost code(s).`
        );
      } else {
        const result = await runSync(kind);
        if (kind === "users") {
          setTimecardSyncMessage(`Synced company users: ${result?.totalUpserted ?? 0} upserted.`);
        } else if (kind === "types") {
          setTimecardSyncMessage(`Synced timecard time types: ${result?.totalTypesSaved ?? result?.totalTypesFetched ?? 0} saved across ${result?.projectsWithTypes ?? 0} project(s).`);
        } else {
          setTimecardSyncMessage(`Synced cost codes: ${result?.totalFetched ?? 0} fetched for project ${projectId}.`);
        }
      }
    } catch (error) {
      setTimecardCsvError(error instanceof Error ? error.message : String(error));
    } finally {
      setTimecardSyncBusy(null);
    }
  };

  const handleDownloadTimecardJson = () => {
    let fallback: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(timecardFallbackJsonText || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        fallback = parsed as Record<string, unknown>;
      }
    } catch {
      // ignore invalid fallback JSON on download; raw payloads are still useful
    }

    downloadJson(
      "timecard-entries-converted.json",
      timecardCsvRows.map((row) => ({
        rowNumber: row.rowNumber,
        payload: mergeTimecardFallbackPayload(row.payload, fallback),
        resolved: row.resolved,
        resolutionNotes: row.resolutionNotes,
      }))
    );
  };

  const handleBulkCreateTimecardEntries = async () => {
    const projectId = timecardProjectId.trim();
    if (!projectId) {
      setTimecardCsvError("Project ID is required.");
      return;
    }
    if (timecardCsvRows.length === 0) {
      setTimecardCsvError("Upload and convert a CSV first.");
      return;
    }

    let fallback: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(timecardFallbackJsonText || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Fallback JSON must be an object.");
      }
      fallback = parsed as Record<string, unknown>;
    } catch (error) {
      setTimecardCsvError(`Invalid fallback JSON: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    setTimecardCsvBusy(true);
    setTimecardCsvError(null);
    setTimecardCsvResults(null);

    const updatedRows = [...timecardCsvRows];
    let success = 0;
    let failed = 0;

    for (let i = 0; i < updatedRows.length; i++) {
      const row = updatedRows[i];
      const payload = mergeTimecardFallbackPayload(row.payload, fallback);
      if (!row.resolved && (!payload.party_id || !payload.timecard_time_type_id || !payload.cost_code_id)) {
        updatedRows[i] = {
          ...row,
          status: "error",
          statusMessage: row.resolutionNotes.join(" ") || "Row is missing required resolved IDs.",
        };
        failed += 1;
        setTimecardCsvRows([...updatedRows]);
        continue;
      }

      try {
        const response = await fetch("/api/procore/timecard-entries/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project_id: projectId, timecard_entry: payload }),
        });
        const result = await response.json().catch(() => ({}));
        if (response.ok) {
          const createdId = result?.result?.id || result?.result?.data?.id || "OK";
          updatedRows[i] = { ...row, status: "success", statusMessage: `ID ${createdId}` };
          success += 1;
        } else {
          const upstreamMessage =
            result?.result?.error?.message ||
            result?.result?.message ||
            result?.result?.details ||
            result?.result?.error ||
            result?.rawResponseText ||
            result?.details ||
            result?.error;
          const message = upstreamMessage || `Create failed (${response.status}).`;
          updatedRows[i] = { ...row, status: "error", statusMessage: message };
          failed += 1;
        }
      } catch (error) {
        updatedRows[i] = {
          ...row,
          status: "error",
          statusMessage: error instanceof Error ? error.message : String(error),
        };
        failed += 1;
      }

      setTimecardCsvRows([...updatedRows]);
    }

    setTimecardCsvBusy(false);
    setTimecardCsvResults({ success, failed });
  };

  function buildPurchaseOrderContractCsvRows(content: string, fileName: string): PurchaseOrderContractCsvRow[] {
    const lines = parseCsvRecords(content);
    if (lines.length < 2) return [];

    const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase().trim());
    const contractIndex =
      headers.indexOf("contract") >= 0
        ? headers.indexOf("contract")
        : headers.indexOf("number");
    const vendorIndex =
      headers.indexOf("vendor") >= 0
        ? headers.indexOf("vendor")
        : headers.indexOf("contract company");
    const titleIndex = headers.indexOf("title");
    const dateIndex =
      headers.indexOf("date") >= 0
        ? headers.indexOf("date")
        : headers.indexOf("signed contract received date");

    if (contractIndex < 0 || dateIndex < 0) {
      throw new Error(
        "CSV must contain Contract+Date columns (or Number + Signed Contract Received Date aliases)."
      );
    }

    const vendorIdIndex =
      headers.indexOf("vendor_id") >= 0
        ? headers.indexOf("vendor_id")
        : headers.indexOf("vendor id");

    const contractTypeIndex = headers.indexOf("contract type");
    const statusIndex = headers.indexOf("status");
    const executedIndex = headers.indexOf("executed");
    const privateIndex = headers.indexOf("private");
    const ssovStatusIndex = headers.indexOf("ssov status");
    const descriptionIndex = headers.indexOf("description");
    const accountingMethodIndex = headers.indexOf("accounting method");

    const grouped = new Map<
      string,
      {
        vendor: string;
        vendorId?: string;
        title: string;
        dates: string[];
        count: number;
        contractType?: string;
        status?: string;
        executed?: boolean;
        isPrivate?: boolean;
        ssovStatus?: string;
        description?: string;
        accountingMethod?: "amount" | "unit";
      }
    >();

    for (let i = 1; i < lines.length; i++) {
      const values = parseCsvLine(lines[i]);
      const contractLabel = (values[contractIndex] || "").trim();
      if (!contractLabel) continue;
      const vendorName = (vendorIndex >= 0 ? values[vendorIndex] : "")?.trim() || "";
      const vendorIdRaw = (vendorIdIndex >= 0 ? values[vendorIdIndex] : "")?.trim() || "";
      const vendorIdParsed = /^\d+$/.test(vendorIdRaw) ? vendorIdRaw : "";
      const titleValue = (titleIndex >= 0 ? values[titleIndex] : "")?.trim() || "";
      const dateValue = (values[dateIndex] || "").trim();
      const dateIso = parseShortDateToIso(dateValue);
      const contractTypeRaw = (contractTypeIndex >= 0 ? values[contractTypeIndex] : "")?.trim() || "";
      const mappedContractType = mapCommitmentTypeFromCsv(contractTypeRaw);
      const statusRaw = (statusIndex >= 0 ? values[statusIndex] : "")?.trim() || "";
      const executedRaw = (executedIndex >= 0 ? values[executedIndex] : "")?.trim() || "";
      const privateRaw = (privateIndex >= 0 ? values[privateIndex] : "")?.trim() || "";
      const ssovStatusRaw = (ssovStatusIndex >= 0 ? values[ssovStatusIndex] : "")?.trim() || "";
      const descriptionRaw = (descriptionIndex >= 0 ? values[descriptionIndex] : "")?.trim() || "";
      const accountingMethodRaw = (accountingMethodIndex >= 0 ? values[accountingMethodIndex] : "")?.trim() || "";
      const executedValue = parseYesNoBoolean(executedRaw);
      const privateValue = parseYesNoBoolean(privateRaw);
      const accountingMethodValue = normalizeAccountingMethod(accountingMethodRaw);

      if (!grouped.has(contractLabel)) {
        grouped.set(contractLabel, {
          vendor: vendorName,
          vendorId: vendorIdParsed || undefined,
          title: titleValue,
          dates: [],
          count: 0,
          contractType: mappedContractType,
          status: statusRaw || undefined,
          executed: executedValue,
          isPrivate: privateValue,
          ssovStatus: ssovStatusRaw || undefined,
          description: descriptionRaw || undefined,
          accountingMethod: accountingMethodValue,
        });
      }
      const group = grouped.get(contractLabel)!;
      if (!group.vendor && vendorName) group.vendor = vendorName;
      if (group.vendorId === undefined && vendorIdParsed) {
        group.vendorId = vendorIdParsed;
      }
      if (!group.title && titleValue) group.title = titleValue;
      if (!group.contractType && mappedContractType) group.contractType = mappedContractType;
      if (!group.status && statusRaw) group.status = statusRaw;
      if (group.executed === undefined && executedValue !== undefined) group.executed = executedValue;
      if (group.isPrivate === undefined && privateValue !== undefined) group.isPrivate = privateValue;
      if (!group.ssovStatus && ssovStatusRaw) group.ssovStatus = ssovStatusRaw;
      if (!group.description && descriptionRaw) group.description = descriptionRaw;
      if (!group.accountingMethod && accountingMethodValue) group.accountingMethod = accountingMethodValue;
      if (dateIso) group.dates.push(dateIso);
      group.count += 1;
    }

    const rows: PurchaseOrderContractCsvRow[] = [];
    for (const [contractLabel, group] of grouped.entries()) {
      const parsed = parseContractLabel(contractLabel);
      const number = parsed.number;
      const title = group.title || parsed.title;
      const sortedDates = [...group.dates].sort();
      const contractDate = sortedDates[0] || "";
      const accountingMethod = purchaseOrderContractCsvAllowUnitAccounting
        ? group.accountingMethod || "amount"
        : "amount";
      const isPrivate = purchaseOrderContractCsvAllowPrivate ? group.isPrivate ?? false : false;
      rows.push({
        contractLabel,
        vendorName: group.vendor,
        vendorId: group.vendorId,
        contractNumber: number,
        contractTitle: title,
        contractDate,
        rowCount: group.count,
        status: "pending",
        payload: {
          type: group.contractType || "PurchaseOrderContract",
          accounting_method: accountingMethod,
          contract_date: contractDate,
          delivery_date: contractDate,
          issued_on_date: contractDate,
          signed_contract_received_date: contractDate,
          number,
          title,
          description: group.description || `Imported from CSV (${fileName}).`,
          status: group.status || "Approved",
          ...(group.executed !== undefined ? { executed: group.executed } : {}),
          private: isPrivate,
          ...(group.ssovStatus ? { billing_schedule_of_values_status: group.ssovStatus.toLowerCase() } : {}),
          ...(group.ssovStatus ? { enable_ssov: true } : {}),
          payment_terms: "Net 30",
          ...(group.vendorId !== undefined ? { vendor_id: group.vendorId } : {}),
        },
      });
    }

    return rows.sort((a, b) => a.contractNumber.localeCompare(b.contractNumber));
  }

  const handlePurchaseOrderContractCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPurchaseOrderContractCsvError(null);
    setPurchaseOrderContractCsvSummary(null);
    setPurchaseOrderContractCsvResults(null);
    setPurchaseOrderContractCsvRows([]);

    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setPurchaseOrderContractCsvError("Please upload a .csv file.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = String(event.target?.result || "");
        const rows = buildPurchaseOrderContractCsvRows(content, file.name);
        if (rows.length === 0) {
          setPurchaseOrderContractCsvError("No contract rows were parsed from CSV.");
          return;
        }
        setPurchaseOrderContractCsvRows(rows);
        setPurchaseOrderContractCsvSummary(`Prepared ${rows.length} purchase order contract(s) for import.`);
      } catch (err) {
        setPurchaseOrderContractCsvError(err instanceof Error ? err.message : String(err));
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleBulkCreatePurchaseOrderContractsFromCsv = async () => {
    const projectId = purchaseOrderContractProjectId.trim();
    if (!projectId) {
      setPurchaseOrderContractCsvError("Project ID is required.");
      return;
    }
    if (purchaseOrderContractCsvRows.length === 0) {
      setPurchaseOrderContractCsvError("Upload a CSV first.");
      return;
    }

    setPurchaseOrderContractCsvBusy(true);
    setPurchaseOrderContractCsvError(null);
    setPurchaseOrderContractCsvResults(null);

    let success = 0;
    let failed = 0;
    const updatedRows = [...purchaseOrderContractCsvRows];

    for (let i = 0; i < updatedRows.length; i++) {
      const row = updatedRows[i];
      try {
        const response = await fetch("/api/procore/purchase-order-contracts/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_id: projectId,
            purchase_order_contract: row.payload,
            run_configurable_validations: purchaseOrderContractRunValidations,
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (response.ok) {
          const createdId = result?.data?.id || result?.id || "OK";
          updatedRows[i] = { ...row, status: "success", statusMessage: `ID ${createdId}` };
          success += 1;
        } else {
          const msg = result?.details || result?.error || `Create failed (${response.status}).`;
          updatedRows[i] = { ...row, status: "error", statusMessage: msg };
          failed += 1;
        }
      } catch (err) {
        updatedRows[i] = {
          ...row,
          status: "error",
          statusMessage: err instanceof Error ? err.message : String(err),
        };
        failed += 1;
      }

      setPurchaseOrderContractCsvRows([...updatedRows]);
    }

    setPurchaseOrderContractCsvBusy(false);
    setPurchaseOrderContractCsvResults({ success, failed });
  };

  function parseMoneyLike(value: string): number {
    const parsed = Number(String(value || "").replace(/[$,]/g, "").trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function toPositiveNumber(value: string): number {
    const parsed = Number(String(value || "").replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function normalizeMappingKey(value: string): string {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function normalizeNumericIdToken(value: string): string {
    const token = String(value || "").trim();
    if (!token) return "";
    const decommad = token.replace(/,/g, "");
    const numericLike = decommad.match(/^(\d+)(?:\.0+)?$/);
    if (numericLike) return numericLike[1];
    const scientificLike = decommad.match(/^[-+]?\d+(?:\.\d+)?[eE][-+]?\d+$/);
    if (scientificLike) {
      const asNumber = Number(decommad);
      if (Number.isFinite(asNumber)) {
        // Convert scientific notation to plain integer token for Procore IDs.
        return asNumber.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 0 });
      }
    }
    return token;
  }

  function isLikelyIdToken(value: string): boolean {
    return /^\d{8,}$/.test(String(value || "").trim());
  }

  function normalizeCostTypeCode(value: string): string {
    const token = normalizeMappingKey(value);
    if (!token) return "";
    if (token === "equipment" || token === "e") return "E";
    if (token === "labor" || token === "l") return "L";
    if (token === "material" || token === "m") return "M";
    if (token === "subcontractor" || token === "sub" || token === "s") return "S";
    if (token === "other" || token === "o") return "O";
    return token.toUpperCase();
  }

  type PurchaseOrderLineItemProjectRefs = {
    costCodes: Array<{ id: number; fullCode: string; name: string }>;
    costTypes: Array<{ id: number; code: string; name: string }>;
    costTypeByCodeMap: Record<string, string>;
    wbsCodeMap: Record<string, number>;
  };

  async function fetchPurchaseOrderLineItemReferences(projectId: string): Promise<PurchaseOrderLineItemProjectRefs> {
    const runLookup = async (
      path: string,
      query: Record<string, unknown>,
      opts?: { optional404?: boolean }
    ) => {
      const response = await fetch("/api/procore/rest-runner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "GET", path, query }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (opts?.optional404 && response.status === 404) {
          return [];
        }
        const details = result?.details || result?.error || `Lookup failed (${response.status}).`;
        throw new Error(`${path}: ${details}`);
      }
      return Array.isArray(result?.result) ? result.result : [];
    };

    const [costCodeRows, costTypeRows, budgetLineItems, wbsCodeRows] = await Promise.all([
      runLookup("/rest/v1.0/cost_codes", { project_id: projectId, page: 1, per_page: 1000 }),
      runLookup("/rest/v1.0/line_item_types", { project_id: projectId, page: 1, per_page: 1000 }),
      runLookup("/rest/v1.0/budget_line_items", { project_id: projectId, page: 1, per_page: 1000 }, { optional404: true }),
      runLookup("/rest/v1.0/projects/" + projectId + "/wbs_codes", { page: 1, per_page: 1000 }, { optional404: true }),
    ]);

    const costCodes = costCodeRows
      .map((row: any) => ({
        id: Number(row?.id),
        fullCode: String(row?.full_code || row?.code || "").trim(),
        name: String(row?.name || "").trim(),
      }))
      .filter((row: any) => Number.isFinite(row.id) && row.id > 0);

    const costTypes = costTypeRows
      .map((row: any) => ({
        id: Number(row?.id),
        code: String(row?.code || "").trim(),
        name: String(row?.name || "").trim(),
      }))
      .filter((row: any) => Number.isFinite(row.id) && row.id > 0);

    const typeCodeByName: Record<string, string> = {};
    for (const row of costTypes) {
      const nameKey = normalizeMappingKey(row.name);
      const codeValue = String(row.code || "").trim().toUpperCase();
      if (nameKey && codeValue) {
        typeCodeByName[nameKey] = codeValue;
      }
    }

    const costTypeByCodeMap: Record<string, string> = {};
    for (const row of budgetLineItems as any[]) {
      const costCode = row?.cost_code || {};
      const lineItemType = row?.line_item_type || {};
      const typeName = String(lineItemType?.name || "").trim();
      const typeNameKey = normalizeMappingKey(typeName);
      const directCode = String(lineItemType?.code || "").trim().toUpperCase();
      const mappedCode = typeNameKey ? typeCodeByName[typeNameKey] || "" : "";
      const costTypeCode = directCode || mappedCode || normalizeCostTypeCode(typeName);
      const fullCode = String(costCode?.full_code || costCode?.code || "").trim();
      const costCodeId = String(costCode?.id || "").trim();
      if (!costTypeCode) continue;
      if (fullCode) costTypeByCodeMap[normalizeMappingKey(fullCode)] = costTypeCode;
      if (costCodeId) costTypeByCodeMap[normalizeMappingKey(costCodeId)] = costTypeCode;
    }

    const wbsCodeMap: Record<string, number> = {};
    for (const row of wbsCodeRows as any[]) {
      const flatCode = String(row?.flat_code || "").trim();
      const wbsId = Number(row?.id);
      if (flatCode && Number.isFinite(wbsId) && wbsId > 0) {
        wbsCodeMap[normalizeMappingKey(flatCode)] = wbsId;
      }
    }

    return {
      costCodes,
      costTypes,
      costTypeByCodeMap,
      wbsCodeMap,
    };
  }

  function buildPurchaseOrderLineItemPayloadFromCsvRow(
    row: Pick<PurchaseOrderLineItemCsvRow, "costCodeRaw" | "costType" | "description" | "quantity" | "uom" | "unitPrice" | "amount">,
    refs?: PurchaseOrderLineItemProjectRefs
  ): { payload: Record<string, unknown>; mappedCostCode: string; mappedCostType: string } {
    const defaultLineItemTypeId = Number(purchaseOrderLineItemCsvDefaultTypeId.trim());
    const defaultWbsId = Number(purchaseOrderLineItemCsvDefaultWbsId.trim());
    const defaultBudgetLineItemId = Number(purchaseOrderLineItemCsvDefaultBudgetLineItemId.trim());

    const refCostCodes = refs?.costCodes || purchaseOrderLineItemCostCodes;
    const refCostTypes = refs?.costTypes || purchaseOrderLineItemCostTypes;
    const refTypeByCodeMap: Record<string, string> = {
      ...(refs?.costTypeByCodeMap || {}),
      ...purchaseOrderLineItemCostTypeByCodeMap,
    };
    const permanentTypeByCodeMap: Record<string, string> = Object.fromEntries(
      Object.entries(PROCORE_PERMANENT_COST_TYPE_BY_CODE).map(([code, type]) => [
        normalizeMappingKey(code),
        normalizeCostTypeCode(type),
      ])
    );
    const refWbsMap = refs?.wbsCodeMap || purchaseOrderLineItemWbsCodeMap;

    const costCodeIdByFullCode = new Map<string, number>();
    for (const codeRow of refCostCodes) {
      const key = normalizeMappingKey(codeRow.fullCode || String(codeRow.id));
      if (key && Number.isFinite(codeRow.id) && codeRow.id > 0) {
        costCodeIdByFullCode.set(key, codeRow.id);
      }
    }

    const lineItemTypeIdByCodeOrName = new Map<string, number>();
    for (const typeRow of refCostTypes) {
      if (!Number.isFinite(typeRow.id) || typeRow.id <= 0) continue;
      const codeKey = normalizeMappingKey(typeRow.code);
      const nameKey = normalizeMappingKey(typeRow.name);
      if (codeKey) lineItemTypeIdByCodeOrName.set(codeKey, typeRow.id);
      if (nameKey) lineItemTypeIdByCodeOrName.set(nameKey, typeRow.id);
    }

    const mappedCostCode =
      purchaseOrderLineItemCostCodeMap[normalizeMappingKey(row.costCodeRaw)] || row.costCodeRaw;
    const normalizedRowType = normalizeMappingKey(row.costType);
    const mappedTypeByCodeExact =
      refTypeByCodeMap[`${normalizeMappingKey(row.costCodeRaw)}|${normalizedRowType}`] || "";
    const mappedTypeByCodeDefault =
      (!normalizedRowType || normalizedRowType === "o" || normalizedRowType === "other")
        ? permanentTypeByCodeMap[normalizeMappingKey(row.costCodeRaw)] ||
          permanentTypeByCodeMap[normalizeMappingKey(mappedCostCode)] ||
          refTypeByCodeMap[normalizeMappingKey(row.costCodeRaw)] ||
          refTypeByCodeMap[normalizeMappingKey(mappedCostCode)] ||
          ""
        : "";
    const rowCostTypeIsGenericOther = normalizedRowType === "o" || normalizedRowType === "other";
    const explicitRowCostType = rowCostTypeIsGenericOther ? "" : row.costType;
    const mappedCostType =
      mappedTypeByCodeExact ||
      mappedTypeByCodeDefault ||
      purchaseOrderLineItemCostTypeMap[normalizedRowType] ||
      explicitRowCostType ||
      row.costType;

    const payload: Record<string, unknown> = {
      description: row.description,
      quantity: row.quantity,
      uom: row.uom,
      unit_cost: row.unitPrice,
      amount: row.amount,
      extended_type: "manual",
    };

    if (Number.isFinite(defaultLineItemTypeId) && defaultLineItemTypeId > 0) {
      payload.line_item_type_id = defaultLineItemTypeId;
    }
    if (Number.isFinite(defaultWbsId) && defaultWbsId > 0) {
      payload.wbs_code_id = defaultWbsId;
    }
    if (Number.isFinite(defaultBudgetLineItemId) && defaultBudgetLineItemId > 0) {
      payload.budget_line_item_id = defaultBudgetLineItemId;
    }

    const numericCostCode = Number(mappedCostCode);
    const mappedCostCodeId =
      Number.isFinite(numericCostCode) && numericCostCode > 0
        ? numericCostCode
        : costCodeIdByFullCode.get(normalizeMappingKey(mappedCostCode || ""));

    if (mappedCostCodeId !== undefined) {
      payload.cost_code_id = mappedCostCodeId;
    } else if (mappedCostCode) {
      payload.origin_data = mappedCostCode;
    }

    if (mappedCostType) {
      payload.origin_code = mappedCostType;
      const mappedTypeId = lineItemTypeIdByCodeOrName.get(normalizeMappingKey(mappedCostType));
      if (mappedTypeId && (!payload.line_item_type_id || Number(payload.line_item_type_id) <= 0)) {
        payload.line_item_type_id = mappedTypeId;
      }
    }

    if (!payload.wbs_code_id || Number(payload.wbs_code_id) <= 0) {
      const effectiveCostCode = mappedCostCode || row.costCodeRaw;
      const effectiveType = mappedCostType || row.costType;
      if (effectiveCostCode && effectiveType) {
        const flatKey = normalizeMappingKey(`${effectiveCostCode}.${effectiveType}`);
        const resolvedWbsId = refWbsMap[flatKey];
        if (resolvedWbsId) payload.wbs_code_id = resolvedWbsId;
      }
    }

    // Secondary fallback: if exact {costCode}.{type} was not found, try matching by cost code prefix in WBS map.
    // This handles files with generic/legacy type labels where project WBS uses a different type code.
    if (!payload.wbs_code_id || Number(payload.wbs_code_id) <= 0) {
      const effectiveCostCode = normalizeMappingKey(mappedCostCode || row.costCodeRaw);
      if (effectiveCostCode) {
        const segments = effectiveCostCode.split("-").filter(Boolean);
        const codePrefixes: string[] = [];
        for (let i = segments.length; i >= 2; i--) {
          codePrefixes.push(normalizeMappingKey(segments.slice(0, i).join("-")));
        }
        if (!codePrefixes.includes(effectiveCostCode)) {
          codePrefixes.unshift(effectiveCostCode);
        }

        const candidates = Object.entries(refWbsMap).filter(([flatCode]) => {
          return codePrefixes.some((codePrefix) =>
            flatCode.startsWith(`${codePrefix}.`) || flatCode.startsWith(`${codePrefix}-`)
          );
        });

        if (candidates.length > 0) {
          const preferredTypes = [
            normalizeMappingKey(mappedCostType || ""),
            normalizeMappingKey(row.costType || ""),
            normalizeMappingKey(refTypeByCodeMap[effectiveCostCode] || ""),
          ].filter(Boolean);

          let selected = candidates.find(([flatCode]) => {
            const flatParts = flatCode.split(".");
            const suffix = flatParts.length > 1 ? flatParts[flatParts.length - 1] : "";
            return preferredTypes.includes(normalizeMappingKey(suffix));
          });

          if (!selected) {
            // If no preferred type matches, use the first project-valid WBS for this cost code.
            selected = candidates[0];
          }

          const [selectedFlatCode, selectedWbsId] = selected;
          payload.wbs_code_id = selectedWbsId;

          const selectedParts = selectedFlatCode.split(".");
          const selectedTypeCodeRaw = selectedParts.length > 1 ? selectedParts[selectedParts.length - 1] : "";
          const selectedTypeCode = selectedTypeCodeRaw.toUpperCase();
          if (selectedTypeCode) {
            payload.origin_code = selectedTypeCode;
            const selectedTypeId = lineItemTypeIdByCodeOrName.get(normalizeMappingKey(selectedTypeCode));
            if (selectedTypeId && (!payload.line_item_type_id || Number(payload.line_item_type_id) <= 0)) {
              payload.line_item_type_id = selectedTypeId;
            }
          }
        }
      }
    }

    return { payload, mappedCostCode, mappedCostType };
  }

  function isLikelyUom(token: string): boolean {
    const normalized = normalizeMappingKey(token);
    // Only filter out very common, unambiguous UOM patterns
    const obviousUomPatterns = [
      "ea", "each", "sf", "sqft", "square feet", "square foot",
      "cy", "cubic yard", "lf", "lineal foot",
      "ga", "gallon", "gal", "hr", "hour", "hrs",
      "day", "week", "wk", "box", "pallet", "roll"
    ];
    return obviousUomPatterns.includes(normalized);
  }

  function inferCostTypeFromDescription(description: string): string {
    const normalizedDescription = normalizeMappingKey(description);
    if (!normalizedDescription) return "";

    // Domain fallback: rebar line items should always map to Material.
    if (/(^|\b)rebar(\b|$)/.test(normalizedDescription)) {
      return "M";
    }

    return "";
  }

  function sanitizeCostType(token: string, description?: string): string {
    const trimmed = String(token || "").trim();
    const inferredFromDescription = inferCostTypeFromDescription(description || "");
    const normalizedTrimmed = normalizeMappingKey(trimmed);

    // If description clearly indicates rebar/material, override ambiguous "O" values.
    if (inferredFromDescription && (normalizedTrimmed === "o" || normalizedTrimmed === "other")) {
      return inferredFromDescription;
    }

    if (!trimmed || isLikelyUom(trimmed)) {
      return inferredFromDescription;
    }
    return trimmed;
  }

  function buildPurchaseOrderLineItemCsvRows(content: string): PurchaseOrderLineItemCsvRow[] {
    const lines = parseCsvRecords(content);
    if (lines.length < 2) return [];

    const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase().trim());
    const idxCostCode = headers.indexOf("cost code");
    const idxCostType = headers.indexOf("cost type");
    const idxDescription = headers.indexOf("description");
    const idxQuantity = headers.indexOf("quantity");
    const idxUom = headers.indexOf("uom");
    const idxUnitPrice = headers.indexOf("unit price");
    const idxSubtotal = headers.indexOf("subtotal override");
    const idxProjectId = headers.findIndex((h) =>
      ["project_id", "project id", "projectid", "procore project id"].includes(h)
    );
    const idxPurchaseOrderContractId = headers.findIndex((h) =>
      [
        "purchase_order_contract_id",
        "purchase order contract id",
        "purchaseordercontractid",
        "commitment_contract_id",
        "commitment contract id",
      ].includes(h)
    );

    if (idxDescription < 0 || idxQuantity < 0 || idxUom < 0 || idxUnitPrice < 0) {
      throw new Error(
        "CSV must include Description, Quantity, UOM, and Unit Price columns."
      );
    }
    if (idxProjectId < 0 || idxPurchaseOrderContractId < 0) {
      throw new Error(
        "CSV must include project_id and purchase_order_contract_id columns for bulk create."
      );
    }

    const rows: PurchaseOrderLineItemCsvRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = parseCsvLine(lines[i]);
      const description = (values[idxDescription] || "").trim();
      if (!description) continue;

      const quantity = toPositiveNumber(values[idxQuantity] || "");
      const unitPrice = parseMoneyLike(values[idxUnitPrice] || "");
      const subtotalOverride = idxSubtotal >= 0 ? parseMoneyLike(values[idxSubtotal] || "") : 0;
      const amount = subtotalOverride > 0 ? subtotalOverride : Number((quantity * unitPrice).toFixed(2));
      const costCodeRaw = idxCostCode >= 0 ? (values[idxCostCode] || "").trim() : "";
      const costType = sanitizeCostType(
        idxCostType >= 0 ? (values[idxCostType] || "") : "",
        description
      );
      const uom = (values[idxUom] || "").trim() || "ea";

      const rowProjectId = idxProjectId >= 0 ? normalizeNumericIdToken(values[idxProjectId] || "") : "";
      const rowPurchaseOrderContractId =
        idxPurchaseOrderContractId >= 0 ? normalizeNumericIdToken(values[idxPurchaseOrderContractId] || "") : "";

      const { payload, mappedCostCode, mappedCostType } = buildPurchaseOrderLineItemPayloadFromCsvRow({
        costCodeRaw,
        costType,
        description,
        quantity,
        uom,
        unitPrice,
        amount,
      });

      rows.push({
        projectId: rowProjectId || undefined,
        purchaseOrderContractId: rowPurchaseOrderContractId || undefined,
        costCodeRaw,
        costType,
        mappedCostCode,
        mappedCostType,
        description,
        quantity,
        uom,
        unitPrice,
        amount,
        status: "pending",
        payload,
      });
    }

    return rows;
  }

  const handleLoadPurchaseOrderLineItemReferences = async () => {
    const projectId = purchaseOrderLineItemProjectId.trim();
    if (!projectId) {
      setPurchaseOrderLineItemRefsError("Project ID is required.");
      return;
    }

    setPurchaseOrderLineItemRefsBusy(true);
    setPurchaseOrderLineItemRefsError(null);
    setPurchaseOrderLineItemRefsSummary(null);

    try {
      const refs = await fetchPurchaseOrderLineItemReferences(projectId);

      setPurchaseOrderLineItemCostCodes(refs.costCodes);
      setPurchaseOrderLineItemCostTypes(refs.costTypes);
      setPurchaseOrderLineItemWbsCodeMap(refs.wbsCodeMap);
      setPurchaseOrderLineItemCostTypeByCodeMap((prev) => ({ ...refs.costTypeByCodeMap, ...prev }));

      if (refs.costTypes[0]?.id && !purchaseOrderLineItemCsvDefaultTypeId.trim()) {
        setPurchaseOrderLineItemCsvDefaultTypeId(String(refs.costTypes[0].id));
      }

      try {
        const parsed = JSON.parse(purchaseOrderLineItemJsonText || "{}");
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          if (refs.costCodes[0]?.id) parsed.cost_code_id = refs.costCodes[0].id;
          if (refs.costTypes[0]?.id) parsed.line_item_type_id = refs.costTypes[0].id;
          setPurchaseOrderLineItemJsonText(JSON.stringify(parsed, null, 2));
        }
      } catch {
        // Leave JSON untouched if it is currently invalid.
      }

      setPurchaseOrderLineItemRefsSummary(
        `Loaded ${refs.costCodes.length} project cost code(s), ${refs.costTypes.length} cost type(s), and ${Object.keys(refs.costTypeByCodeMap).length} cost-code-to-type mapping(s) from budget line items. Updated line_item JSON with current IDs.`
      );
    } catch (error) {
      setPurchaseOrderLineItemRefsError(error instanceof Error ? error.message : String(error));
    } finally {
      setPurchaseOrderLineItemRefsBusy(false);
    }
  };

  const handlePurchaseOrderLineItemCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPurchaseOrderLineItemCsvError(null);
    setPurchaseOrderLineItemCsvSummary(null);
    setPurchaseOrderLineItemCsvResults(null);
    setPurchaseOrderLineItemCsvRows([]);

    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setPurchaseOrderLineItemCsvError("Please upload a .csv file.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = String(event.target?.result || "");
        const rows = buildPurchaseOrderLineItemCsvRows(content);
        if (rows.length === 0) {
          setPurchaseOrderLineItemCsvError("No line item rows were parsed from CSV.");
          return;
        }
        const groupedTargets = new Set(
          rows.map((row) => `${row.projectId || purchaseOrderLineItemProjectId.trim()}:${row.purchaseOrderContractId || purchaseOrderLineItemContractId.trim()}`)
        );
        setPurchaseOrderLineItemCsvRows(rows);
        setPurchaseOrderLineItemCsvSummary(
          `Prepared ${rows.length} line item(s) for import across ${groupedTargets.size} project/contract target(s). Include project_id and purchase_order_contract_id columns to route rows automatically.`
        );
      } catch (err) {
        setPurchaseOrderLineItemCsvError(err instanceof Error ? err.message : String(err));
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handlePurchaseOrderLineItemMappingUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setPurchaseOrderLineItemMappingBusy(true);
    setPurchaseOrderLineItemMappingError(null);
    setPurchaseOrderLineItemMappingSummary(null);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(arrayBuffer, { type: "array" });
      if (!workbook.SheetNames.length) {
        throw new Error("Workbook has no sheets.");
      }

      const codeMap: Record<string, string> = {};
      const typeMap: Record<string, string> = {};
      const typeByCodeMap: Record<string, string> = {};
      let scannedRowCount = 0;
      let scannedSheetCount = 0;

      const readText = (row: Record<string, unknown>, matcher: (key: string) => boolean): string => {
        for (const [key, value] of Object.entries(row)) {
          if (!matcher(key)) continue;
          const token = String(value ?? "").trim();
          if (token) return token;
        }
        return "";
      };

      const readTextFromNormalized = (
        row: Record<string, unknown>,
        matcher: (normalizedKey: string) => boolean
      ): string => {
        for (const [key, value] of Object.entries(row)) {
          const normalizedKey = normalizeMappingKey(key).replace(/[^a-z0-9]+/g, " ").trim();
          if (!matcher(normalizedKey)) continue;
          const token = String(value ?? "").trim();
          if (token) return token;
        }
        return "";
      };

      const readCostCodeCell = (row: Record<string, unknown>): string =>
        readTextFromNormalized(
          row,
          (k) =>
            (/(^| )cost( |$)/.test(k) && /(^| )code( |$)/.test(k)) ||
            /(^| )full( |$)code( |$)/.test(k) ||
            /^code$/.test(k)
        );

      const readCostTypeCell = (row: Record<string, unknown>): string =>
        readTextFromNormalized(
          row,
          (k) =>
            (/(^| )cost( |$)/.test(k) && /(^| )type( |$)/.test(k)) ||
            /^type$/.test(k) ||
            /(^| )origin( |$)code( |$)/.test(k) ||
            /(^| )line( |$)item( |$)type( |$)/.test(k)
        );

      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) continue;
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
        if (!rows.length) continue;
        scannedSheetCount += 1;
        scannedRowCount += rows.length;

        for (const row of rows) {
          const oldCode =
            readText(row, (k) => /old.*cost.*code|legacy.*cost.*code|from.*cost.*code|cost.*code.*old/i.test(k)) ||
            readText(row, (k) => /^old[_\s-]*code$/i.test(k));
          const newCode =
            readText(row, (k) => /new.*cost.*code|to.*cost.*code|cost.*code.*new/i.test(k)) ||
            readText(row, (k) => /^new[_\s-]*code$/i.test(k));

          const oldType =
            readText(row, (k) => /old.*cost.*type|legacy.*cost.*type|from.*cost.*type|cost.*type.*old/i.test(k)) ||
            readText(row, (k) => /^old[_\s-]*type$/i.test(k)) ||
            readText(row, (k) => /old.*type.*code|legacy.*type.*code|from.*type.*code|type.*code.*old/i.test(k));
          const newType =
            readText(row, (k) => /new.*cost.*type|to.*cost.*type|cost.*type.*new/i.test(k)) ||
            readText(row, (k) => /^new[_\s-]*type$/i.test(k)) ||
            readText(row, (k) => /new.*type.*code|mapped.*type.*code|to.*type.*code|type.*code.*new/i.test(k));

          const oldTypeLoose =
            oldType ||
            readTextFromNormalized(
              row,
              (k) => /(^| )old( |$)|(^| )legacy( |$)|(^| )from( |$)/.test(k) && /(^| )type( |$)|(^| )ct( |$)/.test(k)
            );
          const newTypeLoose =
            newType ||
            readTextFromNormalized(
              row,
              (k) => /(^| )new( |$)|(^| )to( |$)|(^| )mapped( |$)/.test(k) && /(^| )type( |$)|(^| )ct( |$)/.test(k)
            ) ||
            readTextFromNormalized(
              row,
              (k) => /(^| )new( |$)|(^| )to( |$)|(^| )mapped( |$)/.test(k) && /(^| )cost( |$)/.test(k) && /(^| )type( |$)/.test(k)
            );

          // Heuristic fallback for sheets with weak headers: detect type code tokens (e.g., L, E, CON, CP).
          const rowTokens = Object.values(row)
            .map((v) => String(v ?? "").trim())
            .filter(Boolean);
          const typeTokens = rowTokens.filter((v) => /^[A-Za-z]{1,4}$/.test(v));
          const inferredOldType = oldTypeLoose || (typeTokens.length >= 2 ? typeTokens[0] : "");
          const inferredNewType =
            newTypeLoose ||
            (typeTokens.length >= 2 ? typeTokens[typeTokens.length - 1] : typeTokens.length === 1 ? typeTokens[0] : "");

          if (oldCode && newCode) {
            codeMap[normalizeMappingKey(oldCode)] = newCode;
          }
          if (inferredOldType && inferredNewType) {
            typeMap[normalizeMappingKey(inferredOldType)] = inferredNewType;
          }

          if (oldCode && inferredNewType) {
            typeByCodeMap[normalizeMappingKey(oldCode)] = inferredNewType;
            if (inferredOldType) {
              typeByCodeMap[`${normalizeMappingKey(oldCode)}|${normalizeMappingKey(inferredOldType)}`] = inferredNewType;
            }
          }

          if (newCode && inferredNewType) {
            typeByCodeMap[normalizeMappingKey(newCode)] = inferredNewType;
          }

          // Direct mapping mode: workbook provides {cost code, cost type} pairs.
          const directCostCode = readCostCodeCell(row);
          const directCostTypeRaw = readCostTypeCell(row);
          const directCostType = normalizeCostTypeCode(directCostTypeRaw);
          if (directCostCode && directCostType) {
            typeByCodeMap[normalizeMappingKey(directCostCode)] = directCostType;
          }

          // Fallback for simple 2-column cost code mapping sheets.
          if (!oldCode && !newCode) {
            const values = Object.values(row)
              .map((v) => String(v ?? "").trim())
              .filter(Boolean);
            if (values.length >= 2) {
              const left = values[0];
              const right = values[1];
              if (left && right && !codeMap[normalizeMappingKey(left)]) {
                codeMap[normalizeMappingKey(left)] = right;
              }
            }
          }
        }
      }

      if (scannedRowCount === 0) {
        throw new Error("No mapping rows found in workbook.");
      }

      setPurchaseOrderLineItemCostCodeMap(codeMap);
      setPurchaseOrderLineItemCostTypeMap(typeMap);
      setPurchaseOrderLineItemCostTypeByCodeMap(typeByCodeMap);

      await savePurchaseOrderLineItemMappingProfile(codeMap, typeMap, typeByCodeMap);

      setPurchaseOrderLineItemMappingSummary(
        `Loaded mapping from ${file.name} (${scannedSheetCount} sheet(s), ${scannedRowCount} row(s)): ${Object.keys(codeMap).length} cost code mapping(s), ${Object.keys(typeMap).length} global cost type mapping(s), ${Object.keys(typeByCodeMap).length} code-specific cost type mapping(s).`
      );
      setPurchaseOrderLineItemMappingProfileSummary(
        `Saved mapping profile to database: ${Object.keys(codeMap).length} cost code, ${Object.keys(typeMap).length} global cost type, ${Object.keys(typeByCodeMap).length} code-specific mapping(s).`
      );
      setPurchaseOrderLineItemMappingProfileError(null);
    } catch (error) {
      setPurchaseOrderLineItemMappingError(error instanceof Error ? error.message : String(error));
    } finally {
      setPurchaseOrderLineItemMappingBusy(false);
      e.target.value = "";
    }
  };

  const handleBulkCreatePurchaseOrderLineItemsFromCsv = async () => {
    if (purchaseOrderLineItemCsvRows.length === 0) {
      setPurchaseOrderLineItemCsvError("Upload a CSV first.");
      return;
    }

    setPurchaseOrderLineItemCsvBusy(true);
    setPurchaseOrderLineItemCsvError(null);
    setPurchaseOrderLineItemCsvResults(null);

    let success = 0;
    let failed = 0;
    const updatedRows = [...purchaseOrderLineItemCsvRows];
    const projectRefsCache = new Map<string, PurchaseOrderLineItemProjectRefs>();

    const invalidRowIndexes = updatedRows
      .map((row, index) => ({
        index,
        normalizedProjectId: normalizeNumericIdToken(row.projectId || ""),
        normalizedContractId: normalizeNumericIdToken(row.purchaseOrderContractId || ""),
      }))
      .map((x) => ({
        ...x,
        missingProjectId: !x.normalizedProjectId,
        missingContractId: !x.normalizedContractId,
        badProjectId: !!x.normalizedProjectId && !isLikelyIdToken(x.normalizedProjectId),
        badContractId: !!x.normalizedContractId && !isLikelyIdToken(x.normalizedContractId),
      }))
      .filter((x) => x.missingProjectId || x.missingContractId || x.badProjectId || x.badContractId);

    if (invalidRowIndexes.length > 0) {
      for (const invalid of invalidRowIndexes) {
        const existing = updatedRows[invalid.index];
        const missingParts = [
          invalid.missingProjectId ? "project_id" : "",
          invalid.missingContractId ? "purchase_order_contract_id" : "",
          invalid.badProjectId ? "project_id format" : "",
          invalid.badContractId ? "purchase_order_contract_id format" : "",
        ].filter(Boolean);
        updatedRows[invalid.index] = {
          ...existing,
          projectId: invalid.normalizedProjectId || existing.projectId,
          purchaseOrderContractId: invalid.normalizedContractId || existing.purchaseOrderContractId,
          status: "error",
          statusMessage: `Missing required column value(s): ${missingParts.join(", ")}.`,
        };
      }
      setPurchaseOrderLineItemCsvRows([...updatedRows]);
      setPurchaseOrderLineItemCsvBusy(false);
      setPurchaseOrderLineItemCsvError(
        `Bulk create stopped: ${invalidRowIndexes.length} row(s) are missing project_id and/or purchase_order_contract_id.`
      );
      setPurchaseOrderLineItemCsvResults({ success: 0, failed: invalidRowIndexes.length });
      return;
    }

    const getRefsForProject = async (rowProjectId: string): Promise<PurchaseOrderLineItemProjectRefs> => {
      const cached = projectRefsCache.get(rowProjectId);
      if (cached) return cached;
      const refs = await fetchPurchaseOrderLineItemReferences(rowProjectId);
      projectRefsCache.set(rowProjectId, refs);
      return refs;
    };

    for (let i = 0; i < updatedRows.length; i++) {
      const row = updatedRows[i];
      try {
        const rowProjectId = normalizeNumericIdToken(row.projectId || "");
        const rowPurchaseOrderContractId = normalizeNumericIdToken(row.purchaseOrderContractId || "");
        if (!rowProjectId) {
          updatedRows[i] = {
            ...row,
            status: "error",
            statusMessage: "Missing required value: project_id.",
          };
          failed += 1;
          setPurchaseOrderLineItemCsvRows([...updatedRows]);
          continue;
        }
        if (!rowPurchaseOrderContractId) {
          updatedRows[i] = {
            ...row,
            projectId: rowProjectId || row.projectId,
            purchaseOrderContractId: rowPurchaseOrderContractId || row.purchaseOrderContractId,
            status: "error",
            statusMessage: "Missing required value: purchase_order_contract_id.",
          };
          failed += 1;
          setPurchaseOrderLineItemCsvRows([...updatedRows]);
          continue;
        }
        if (!isLikelyIdToken(rowProjectId) || !isLikelyIdToken(rowPurchaseOrderContractId)) {
          updatedRows[i] = {
            ...row,
            projectId: rowProjectId || row.projectId,
            purchaseOrderContractId: rowPurchaseOrderContractId || row.purchaseOrderContractId,
            status: "error",
            statusMessage:
              "Invalid ID format after normalization. Ensure project_id and purchase_order_contract_id are full numeric IDs (not rounded scientific notation).",
          };
          failed += 1;
          setPurchaseOrderLineItemCsvRows([...updatedRows]);
          continue;
        }

        const refs = await getRefsForProject(rowProjectId);
        const rebuilt = buildPurchaseOrderLineItemPayloadFromCsvRow(
          {
            costCodeRaw: row.costCodeRaw,
            costType: row.costType,
            description: row.description,
            quantity: row.quantity,
            uom: row.uom,
            unitPrice: row.unitPrice,
            amount: row.amount,
          },
          refs
        );

        const response = await fetch("/api/procore/purchase-order-contracts/line-items-create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_id: rowProjectId,
            purchase_order_contract_id: rowPurchaseOrderContractId,
            line_item: rebuilt.payload,
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (response.ok) {
          const createdId = result?.result?.id || result?.result?.data?.id || "OK";
          updatedRows[i] = {
            ...row,
            projectId: rowProjectId,
            purchaseOrderContractId: rowPurchaseOrderContractId,
            mappedCostCode: rebuilt.mappedCostCode || row.mappedCostCode,
            mappedCostType: rebuilt.mappedCostType || row.mappedCostType,
            payload: rebuilt.payload,
            status: "success",
            statusMessage: `ID ${createdId}`,
          };
          success += 1;
        } else {
          const upstreamDetailList = Array.isArray(result?.upstream?.error?.details)
            ? (result.upstream.error.details as Array<Record<string, unknown>>)
            : [];
          const upstreamDetailText = upstreamDetailList
            .map((d) => String(d?.message || d?.reason_code || "").trim())
            .filter(Boolean)
            .join("; ");
          const validationHintsText = Array.isArray(result?.validationHints)
            ? (result.validationHints as unknown[])
                .map((hint) => String(hint || "").trim())
                .filter(Boolean)
                .join("; ")
            : "";

          const msg =
            upstreamDetailText ||
            validationHintsText ||
            result?.details ||
            result?.error ||
            `Create failed (${response.status}).`;

          updatedRows[i] = {
            ...row,
            projectId: rowProjectId,
            purchaseOrderContractId: rowPurchaseOrderContractId,
            mappedCostCode: rebuilt.mappedCostCode || row.mappedCostCode,
            mappedCostType: rebuilt.mappedCostType || row.mappedCostType,
            payload: rebuilt.payload,
            status: "error",
            statusMessage: msg,
          };
          failed += 1;
        }
      } catch (err) {
        const details = err instanceof Error ? err.message : String(err);
        updatedRows[i] = {
          ...row,
          status: "error",
          statusMessage: `Project ${row.projectId || "(missing)"}: ${details}`,
        };
        failed += 1;
      }

      setPurchaseOrderLineItemCsvRows([...updatedRows]);
    }

    setPurchaseOrderLineItemCsvBusy(false);
    setPurchaseOrderLineItemCsvResults({ success, failed });
  };

  const handleCreatePurchaseOrderContractLineItem = async () => {
    const projectId = purchaseOrderLineItemProjectId.trim();
    const purchaseOrderContractId = purchaseOrderLineItemContractId.trim();

    if (!projectId) {
      setPurchaseOrderLineItemError("Project ID is required.");
      return;
    }

    if (!purchaseOrderContractId) {
      setPurchaseOrderLineItemError("Purchase Order Contract ID is required.");
      return;
    }

    let lineItemPayload: Record<string, unknown>;
    try {
      const parsed = JSON.parse(purchaseOrderLineItemJsonText);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("JSON must be an object.");
      }
      lineItemPayload = parsed as Record<string, unknown>;
    } catch (e) {
      setPurchaseOrderLineItemError(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    setPurchaseOrderLineItemBusy(true);
    setPurchaseOrderLineItemError(null);
    setPurchaseOrderLineItemResult(null);

    try {
      const response = await fetch("/api/procore/purchase-order-contracts/line-items-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          purchase_order_contract_id: purchaseOrderContractId,
          line_item: lineItemPayload,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setPurchaseOrderLineItemError(
          result?.details
            ? `${result.error}: ${result.details}`
            : result?.error || `Create failed (${response.status}).`
        );
      }
      setPurchaseOrderLineItemResult({ status: response.status, ok: response.ok, result });
    } catch (err) {
      setPurchaseOrderLineItemError(err instanceof Error ? err.message : String(err));
    } finally {
      setPurchaseOrderLineItemBusy(false);
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

  // ΓöÇΓöÇ Step 2: Line Item Groups helpers ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

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

  // ΓöÇΓöÇ Step 3: Line Items helpers ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

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

    // Fetch group nameΓåÆid map if any row uses group_name and IDs are provided
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
      // Resolve group names ΓåÆ IDs once before the loop
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

  const handlePullProposalShow = async () => {
    const projectId = proposalShowProjectId.trim();
    const bidBoardProjectId = proposalShowBidBoardProjectId.trim();
    const proposalId = proposalShowProposalId.trim();
    if (!projectId || !proposalId) {
      setProposalShowError("Project ID and Proposal ID are required.");
      return;
    }

    setProposalShowBusy(true);
    setProposalShowError(null);
    setProposalShowResult(null);
    try {
      const response = await fetch("/api/procore/estimating/proposals-show", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, proposalId, ...(bidBoardProjectId ? { bidBoardProjectId } : {}) }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setProposalShowError(
          result?.error
            ? `${result.error}${result?.details ? `: ${result.details}` : ""}`
            : `Pull failed (${response.status}).`
        );
      }
      setProposalShowResult({ status: response.status, ok: response.ok, result });
    } catch (err) {
      setProposalShowError(err instanceof Error ? err.message : String(err));
    } finally {
      setProposalShowBusy(false);
    }
  };

  const handleExportProposalCsv = async () => {
    setProposalCsvBusy(true);
    setProposalShowError(null);

    const result = proposalShowResult?.result;
    const lineItemGroups = Array.isArray(result?.lineItemGroups) ? result.lineItemGroups : [];
    const proposal = result?.proposal && typeof result.proposal === "object" ? result.proposal : {};

    const projectId = proposalShowProjectId.trim();
    const proposalId = proposalShowProposalId.trim();

    let liveRows: Record<string, unknown>[] = [];
    if (proposalId) {
      try {
        const liveResponse = await fetch(
          `/api/procore/estimating/proposal-line-items-live?proposalId=${encodeURIComponent(proposalId)}&pageSize=10000`,
          {
            method: "GET",
            cache: "no-store",
          }
        );
        const liveResult = await liveResponse.json().catch(() => ({}));
        liveRows = Array.isArray(liveResult?.data)
          ? liveResult.data.filter((entry: unknown): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
          : [];
      } catch {
        liveRows = [];
      }
    }

    if (!liveRows.length && projectId && proposalId) {
      try {
        const estimatorResponse = await fetch(`/api/procore/estimating/estimating-project?projectId=${encodeURIComponent(projectId)}`, {
          method: "GET",
          cache: "no-store",
        });
        const estimatorResult = await estimatorResponse.json().catch(() => ({}));
        const summary = estimatorResult?.summary && typeof estimatorResult.summary === "object" ? estimatorResult.summary : null;
        const fallbackBidBoardProjectId = String(summary?.bidBoardProjectId || "").trim();

        if (fallbackBidBoardProjectId) {
          const liveResponse = await fetch(
            `/api/procore/estimating/proposal-line-items-live?bidBoardProjectId=${encodeURIComponent(fallbackBidBoardProjectId)}&proposalId=${encodeURIComponent(proposalId)}&pageSize=10000`,
            {
              method: "GET",
              cache: "no-store",
            }
          );
          const liveResult = await liveResponse.json().catch(() => ({}));
          liveRows = Array.isArray(liveResult?.data)
            ? liveResult.data.filter((entry: unknown): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
            : [];
        }
      } catch {
        liveRows = [];
      }
    }

    const sourceRows = liveRows.length > 0
      ? liveRows
      : Array.isArray(result?.lineItems)
        ? result.lineItems
        : Array.isArray(lineItemPayloadPullResult?.lineItems)
          ? lineItemPayloadPullResult.lineItems
          : [];

    if (!sourceRows.length) {
      setProposalShowError("No line items are available to export yet. Resolve the bid board project from the project ID or supply it manually.");
      setProposalCsvBusy(false);
      return;
    }

    const rowByGroupId = new Map<string, Record<string, unknown>>();
    for (const group of lineItemGroups as Record<string, unknown>[]) {
      const groupId = String(group?.id || group?.group_id || group?.line_item_group_id || "").trim();
      if (groupId) rowByGroupId.set(groupId, group);
    }

    const getText = (value: unknown): string => {
      if (typeof value === "string") return value.trim();
      if (typeof value === "number" && Number.isFinite(value)) return String(value);
      return "";
    };

    const getNumber = (value: unknown): string => {
      if (typeof value === "number" && Number.isFinite(value)) return String(value);
      if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? String(parsed) : "";
      }
      return "";
    };

    const readCostCode = (...values: unknown[]): string => {
      for (const value of values) {
        if (value && typeof value === "object") {
          const record = value as Record<string, unknown>;
          const nested =
            getText(record.code) ||
            getText(record.full_code) ||
            getText(record.cost_code) ||
            getText(record.value) ||
            getText(record.display) ||
            getText(record.number);
          if (nested) return nested;
        }
        const text = getText(value);
        if (text) return text;
      }
      return "";
    };

    const readBudgetCode = (...values: unknown[]): string => {
      for (const value of values) {
        if (value && typeof value === "object") {
          const record = value as Record<string, unknown>;
          const nested =
            getText(record.code) ||
            getText(record.full_code) ||
            getText(record.cost_code) ||
            getText(record.value) ||
            getText(record.display) ||
            getText(record.number);
          if (nested) return nested;
        }
        const text = getText(value);
        if (text) return text;
      }
      return "";
    };

    const companyId = getText(result?.companyId);
    const catalogCodeCache = new Map<string, Promise<string>>();

    const looksLikeIdentifier = (value: string, ...ids: string[]): boolean => {
      if (!value) return false;
      if (ids.some((id) => id && value === id)) return true;
      return /^\d+$/.test(value);
    };

    const looksLikeCostCode = (value: string): boolean => {
      if (!value) return false;
      return /[-./]/.test(value) || /\d/.test(value);
    };

    const fetchCatalogCodeByItemId = async (itemId: string): Promise<string> => {
      if (!companyId || !itemId) return "";
      const cached = catalogCodeCache.get(itemId);
      if (cached) return cached;

      const pending = (async () => {
        try {
          const response = await fetch("/api/procore/sync/estimating-catalog-item", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
            body: JSON.stringify({ companyId, itemId }),
          });
          const json = await response.json().catch(() => ({}));
          if (!response.ok) return "";
          const itemPayload = json?.item && typeof json.item === "object" ? (json.item as Record<string, unknown>) : {};
          return readBudgetCode(itemPayload.code, itemPayload.full_code, itemPayload.cost_code, itemPayload.costCode);
        } catch {
          return "";
        }
      })();

      catalogCodeCache.set(itemId, pending);
      return pending;
    };

    const resolveRowCodes = async (row: Record<string, unknown>, payload: Record<string, unknown> = {}, costItem: Record<string, unknown> = {}) => {
      const lineItemId = getText(row.line_item_id ?? row.lineItemId ?? row.id);
      const costItemId = getText(costItem.id ?? payload.cost_item_id ?? payload.costItemId ?? row.cost_item_id ?? row.costItemId);
      const catalogCode = await fetchCatalogCodeByItemId(costItemId);

      const rawBudgetCode = readBudgetCode(
        row.budget_code,
        row.budgetCode,
        row.cost_code,
        row.costCode,
        row.wbs_code,
        row.wbsCode,
        payload.budget_code,
        payload.budgetCode,
        payload.cost_code,
        payload.costCode,
        payload.wbs_code,
        payload.wbsCode,
        costItem.budget_code,
        costItem.budgetCode,
        costItem.cost_code,
        costItem.costCode,
        costItem.wbs_code,
        costItem.wbsCode
      );

      const rawCostCode = readCostCode(
        row.cost_code,
        row.costCode,
        row.budget_code,
        row.budgetCode,
        row.wbs_code,
        row.wbsCode,
        row.rollupCostCode,
        payload.cost_code,
        payload.costCode,
        payload.budget_code,
        payload.budgetCode,
        payload.wbs_code,
        payload.wbsCode,
        costItem.cost_code,
        costItem.costCode,
        costItem.budget_code,
        costItem.budgetCode,
        costItem.wbs_code,
        costItem.wbsCode
      );

      const budgetCode = catalogCode && (!rawBudgetCode || looksLikeIdentifier(rawBudgetCode, lineItemId, costItemId))
        ? catalogCode
        : looksLikeCostCode(rawBudgetCode)
          ? rawBudgetCode
          : "";
      const costCode = catalogCode && (!rawCostCode || looksLikeIdentifier(rawCostCode, lineItemId, costItemId))
        ? catalogCode
        : looksLikeCostCode(rawCostCode)
          ? rawCostCode
          : "";

      return { budgetCode, costCode, catalogCode, lineItemId, costItemId };
    };

    const resolvedSourceRows = await Promise.all(
      sourceRows.map(async (item: Record<string, unknown>) => {
        const payload = item.payload && typeof item.payload === "object" ? (item.payload as Record<string, unknown>) : {};
        const costItem = item.cost_item && typeof item.cost_item === "object" ? (item.cost_item as Record<string, unknown>) : {};
        const groupId = getText(payload.group_id ?? payload.groupId ?? item.group_id ?? item.groupId);
        const itemName = getText(item.name ?? payload.name ?? costItem.name ?? item.description ?? payload.description);
        const codes = await resolveRowCodes(item, payload, costItem);
        const costType = readCostCode(costItem.type, item.cost_type, item.line_item_type, item.type, payload.cost_type, payload.line_item_type);
        const uom = getText(costItem.unit ?? item.uom ?? item.type ?? payload.uom ?? payload.type);

        return {
          item,
          payload,
          costItem,
          groupId,
          itemName,
          ...codes,
          costType,
          uom,
        };
      })
    );

    const groupRows = (lineItemGroups as Record<string, unknown>[]).map((group) => {
      const groupName = getText(group.name ?? group.title ?? group.description);
      const groupId = getText(group.id ?? group.group_id ?? group.line_item_group_id);
      const sourceRow = groupId
        ? resolvedSourceRows.find((entry) => entry.groupId === groupId)
        : undefined;
      const { budgetCode: groupBudgetCode, costCode: groupCostCode } = sourceRow
        ? { budgetCode: sourceRow.budgetCode, costCode: sourceRow.costCode }
        : { budgetCode: "", costCode: "" };
      return [
        "line_item_group",
        getText(result?.companyId),
        getText(result?.projectId),
        getText(result?.bidBoardProjectId),
        getText(result?.proposalId),
        getText((proposal as Record<string, unknown>).name ?? (proposal as Record<string, unknown>).title),
        getText((proposal as Record<string, unknown>).status),
        groupId,
        groupName,
        groupId,
        groupName,
        groupBudgetCode,
        groupCostCode,
        getText(group.cost_type ?? group.costType),
        getText(group.description),
        getNumber(group.count ?? group.quantity ?? group.qty),
        getText(group.uom ?? group.unit ?? group.type),
        getNumber(group.item_cost ?? group.unit_cost),
        getNumber(group.labor_cost),
        getNumber(group.item_sales),
        getNumber(group.labor_sales),
        getNumber(group.total ?? group.amount),
      ];
    });

    const rows = [
      ...groupRows,
      ...resolvedSourceRows.map((entry) => {
      const { item, payload, costItem, groupId, itemName, budgetCode, costCode, costType, uom } = entry;
      const group = groupId ? rowByGroupId.get(groupId) || {} : {};
      const lineItemId = getText(item.line_item_id ?? item.lineItemId ?? item.id);

      return [
        "line_item",
        getText(result?.companyId),
        getText(result?.projectId),
        getText(result?.bidBoardProjectId),
        getText(result?.proposalId),
        getText((proposal as Record<string, unknown>).name ?? (proposal as Record<string, unknown>).title),
        getText((proposal as Record<string, unknown>).status),
        groupId,
        getText(group.name ?? group.title ?? group.description),
        lineItemId,
        itemName,
        budgetCode,
        costCode,
        costType,
        getText(item.description ?? costItem.description),
        getNumber(item.count ?? item.quantity ?? item.qty),
        uom,
        getNumber(item.item_cost ?? item.unit_cost ?? costItem.unit_cost),
        getNumber(item.labor_cost),
        getNumber(item.item_sales),
        getNumber(item.labor_sales),
        getNumber(item.total ?? item.amount),
      ];
      }),
    ];

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadCsv(`procore-estimate-export-${timestamp}.csv`, [
      "row_type",
      "company_id",
      "project_id",
      "bid_board_project_id",
      "proposal_id",
      "proposal_name",
      "proposal_status",
      "group_id",
      "group_name",
      "line_item_id",
      "line_item_name",
      "budget_code",
      "cost_code",
      "cost_type",
      "description",
      "count",
      "uom",
      "item_cost",
      "labor_cost",
      "item_sales",
      "labor_sales",
      "total",
    ], rows);
    setProposalCsvBusy(false);
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
                  ≡ƒöì Procore API Field Mapping
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
                  ≡ƒöì Data Source Diagnostic Results
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
                  ≡ƒôè Database Status
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
                {clearing ? "Clearing..." : "≡ƒùæ∩╕Å Clear Old Data"}
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
                {checkingDatabase ? "Checking..." : "≡ƒôè Check Database"}
              </button>
            </div>

            <div className="bg-white rounded-lg shadow p-6 border-2 border-slate-500 mb-6">
              <h2 className="text-xl font-bold text-slate-900 mb-3">Procore REST Command Runner</h2>
              <p className="text-sm text-gray-600 mb-4">
                Run Procore REST endpoints using the Procore auth you already have in this app.
                Use endpoint paths like <code className="bg-gray-100 px-1 rounded">/rest/v1.3/companies/{"{"}company_id{"}"}/me</code> or full
                <code className="bg-gray-100 px-1 rounded ml-1">https://api.procore.com/rest/...</code> URLs.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Method</label>
                  <select
                    value={restRunnerMethod}
                    onChange={(e) => setRestRunnerMethod(e.target.value)}
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                  >
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                    <option value="PUT">PUT</option>
                    <option value="PATCH">PATCH</option>
                    <option value="DELETE">DELETE</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Path or URL</label>
                  <input
                    type="text"
                    value={restRunnerPath}
                    onChange={(e) => setRestRunnerPath(e.target.value)}
                    placeholder="/rest/v1.3/companies/{company_id}/me"
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm font-mono"
                  />
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-semibold text-gray-700 mb-1">Company ID Override (optional)</label>
                <input
                  type="text"
                  value={restRunnerCompanyIdOverride}
                  onChange={(e) => setRestRunnerCompanyIdOverride(e.target.value)}
                  placeholder="Leave blank to use cookie/env company id"
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm font-mono"
                />
              </div>

              <div className="mb-4">
                <label className="block text-sm font-semibold text-gray-700 mb-1">JSON Body (for POST/PUT/PATCH)</label>
                <textarea
                  value={restRunnerBodyText}
                  onChange={(e) => setRestRunnerBodyText(e.target.value)}
                  rows={10}
                  className="w-full border border-gray-400 rounded px-3 py-2 text-sm leading-6 font-mono text-gray-900 bg-white"
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={handleRunRestCommand}
                  disabled={restRunnerBusy}
                  className="bg-slate-700 hover:bg-slate-800 disabled:bg-gray-400 text-white font-bold py-2 px-4 rounded text-sm"
                >
                  {restRunnerBusy ? "Running..." : "Run REST Command"}
                </button>
              </div>

              {restRunnerError && (
                <div className="mt-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
                  <strong>REST Runner Error:</strong> {restRunnerError}
                </div>
              )}

              {restRunnerResult && (
                <pre className="mt-4 bg-gray-50 border border-gray-300 text-gray-900 p-4 rounded overflow-auto text-sm leading-6 font-mono">
                  {JSON.stringify(restRunnerResult, null, 2)}
                </pre>
              )}
            </div>

            <div className="bg-white rounded-lg shadow p-6 border-2 border-cyan-500 mb-6">
              <h2 className="text-xl font-bold text-cyan-900 mb-3">Company Users Browser</h2>
              <p className="text-sm text-gray-600 mb-4">
                Browse cached company users after running the company-user sync. Use this to find valid Procore user IDs and names when resolving timecard <code className="bg-gray-100 px-1 rounded">party_id</code> candidates.
              </p>

              <div className="flex flex-wrap gap-3 mb-4">
                <input
                  type="text"
                  value={companyUsersSearch}
                  onChange={(e) => setCompanyUsersSearch(e.target.value)}
                  placeholder="Search by name or login"
                  className="flex-1 min-w-[260px] border border-gray-300 rounded px-3 py-2 text-sm"
                />
                <button
                  onClick={handleLoadCompanyUsers}
                  disabled={companyUsersBusy}
                  className="bg-cyan-700 hover:bg-cyan-800 disabled:bg-gray-400 text-white font-bold py-2 px-4 rounded text-sm"
                >
                  {companyUsersBusy ? "Loading..." : "Load Company Users"}
                </button>
              </div>

              {companyUsersSummary && (
                <p className="text-xs text-cyan-800 mb-3">{companyUsersSummary}</p>
              )}

              {companyUsersError && (
                <div className="mb-3 bg-red-50 border border-red-300 text-red-700 px-3 py-2 rounded text-sm">
                  {companyUsersError}
                </div>
              )}

              {companyUsersResult.length > 0 && (
                <div className="overflow-x-auto border border-gray-200 rounded">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left px-3 py-2">User ID</th>
                        <th className="text-left px-3 py-2">Party ID</th>
                        <th className="text-left px-3 py-2">Name</th>
                        <th className="text-left px-3 py-2">Login</th>
                        <th className="text-left px-3 py-2">Company</th>
                        <th className="text-left px-3 py-2">Payload Fields</th>
                      </tr>
                    </thead>
                    <tbody>
                      {companyUsersResult.map((user) => (
                        <tr key={user.id} className="border-t border-gray-200">
                          <td className="px-3 py-2 font-mono">{user.id}</td>
                          <td className="px-3 py-2 font-mono">{user.party_id || "-"}</td>
                          <td className="px-3 py-2">{user.name || "-"}</td>
                          <td className="px-3 py-2">{user.login || "-"}</td>
                          <td className="px-3 py-2">{user.company_name || "-"}</td>
                          <td className="px-3 py-2 align-top">
                            {user.payload && typeof user.payload === "object" ? (
                              <details>
                                <summary className="cursor-pointer text-cyan-800 text-xs font-semibold">
                                  View {Object.keys(user.payload).length} field(s)
                                </summary>
                                <pre className="mt-2 bg-gray-50 border border-gray-200 text-gray-900 p-2 rounded overflow-auto text-xs leading-5 font-mono max-w-[520px]">
                                  {JSON.stringify(user.payload, null, 2)}
                                </pre>
                              </details>
                            ) : (
                              <span className="text-xs text-gray-500">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="bg-white rounded-lg shadow p-6 border-2 border-rose-500 mb-6">
              <h2 className="text-xl font-bold text-rose-900 mb-3">Create Timecard Entries from CSV</h2>
              <p className="text-sm text-gray-600 mb-4">
                Upload a timecard CSV, auto-resolve employee, cost code, and time type IDs from synced Procore data,
                then create real timecard entries through <code className="bg-gray-100 px-1 rounded">/rest/v1.0/projects/{"{"}project_id{"}"}/timecard_entries</code>.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Project ID</label>
                  <input
                    type="text"
                    value={timecardProjectId}
                    onChange={(e) => setTimecardProjectId(e.target.value)}
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div className="flex items-end gap-3 pb-1">
                  <input
                    type="file"
                    accept=".csv"
                    onChange={handleTimecardCsvUpload}
                    className="border border-gray-300 rounded px-3 py-1.5 text-sm bg-white"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-3 mb-4">
                <button
                  onClick={() => handleSyncTimecardLookups("all")}
                  disabled={timecardSyncBusy !== null}
                  className="bg-rose-700 border border-rose-700 text-white hover:bg-rose-800 disabled:bg-gray-100 disabled:border-gray-200 disabled:text-gray-400 font-semibold py-2 px-4 rounded text-sm"
                >
                  {timecardSyncBusy === "all" ? "Syncing All Lookup Data..." : "Sync All Lookup Data"}
                </button>
                <button
                  onClick={() => handleSyncTimecardLookups("users")}
                  disabled={timecardSyncBusy !== null}
                  className="bg-white border border-rose-300 text-rose-800 hover:bg-rose-50 disabled:bg-gray-100 disabled:text-gray-400 font-semibold py-2 px-4 rounded text-sm"
                >
                  {timecardSyncBusy === "users" ? "Syncing Users..." : "Sync Company Users"}
                </button>
                <button
                  onClick={() => handleSyncTimecardLookups("types")}
                  disabled={timecardSyncBusy !== null}
                  className="bg-white border border-rose-300 text-rose-800 hover:bg-rose-50 disabled:bg-gray-100 disabled:text-gray-400 font-semibold py-2 px-4 rounded text-sm"
                >
                  {timecardSyncBusy === "types" ? "Syncing Time Types..." : "Sync Time Types"}
                </button>
                <button
                  onClick={() => handleSyncTimecardLookups("codes")}
                  disabled={timecardSyncBusy !== null}
                  className="bg-white border border-rose-300 text-rose-800 hover:bg-rose-50 disabled:bg-gray-100 disabled:text-gray-400 font-semibold py-2 px-4 rounded text-sm"
                >
                  {timecardSyncBusy === "codes" ? "Syncing Cost Codes..." : "Sync Cost Codes"}
                </button>
              </div>

              {timecardSyncMessage && (
                <div className="mb-3 bg-rose-50 border border-rose-200 text-rose-900 px-3 py-2 rounded text-sm">
                  {timecardSyncMessage}
                </div>
              )}

              <div className="mb-4">
                <label className="block text-sm font-semibold text-gray-700 mb-1">Fallback Fields JSON</label>
                <textarea
                  value={timecardFallbackJsonText}
                  onChange={(e) => setTimecardFallbackJsonText(e.target.value)}
                  rows={6}
                  className="w-full border border-gray-400 rounded px-3 py-2 text-sm leading-6 font-mono text-gray-900 bg-white"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Applied only when the CSV converter could not populate a field. Useful for values like lunch_time, location_id, or line_item_type_id.
                </p>
              </div>

              <div className="mb-4 bg-rose-50 border border-rose-200 rounded p-4">
                <h3 className="text-sm font-bold text-rose-900 mb-2">Required Timecard Entry Template</h3>
                <p className="text-xs text-rose-800 mb-3">
                  The converter is trying to produce these required fields for each row: <strong>date</strong>, <strong>hours</strong>, <strong>party_id</strong>, <strong>timecard_time_type_id</strong>, and <strong>cost_code_id</strong>.
                </p>
                <pre className="bg-white border border-rose-200 text-gray-900 p-3 rounded overflow-auto text-xs leading-6 font-mono">
{`{
  "timecard_entry": {
    "date": "2026-06-12",
    "hours": "7.0",
    "party_id": 598134334614194,
    "timecard_time_type_id": 1,
    "cost_code_id": 12345,
    "description": "Imported timecard entry",
    "billable": true
  }
}`}
                </pre>
              </div>

              <div className="flex flex-wrap gap-3 mb-4">
                <button
                  onClick={handleBulkCreateTimecardEntries}
                  disabled={timecardCsvBusy || timecardCsvRows.length === 0}
                  className="bg-rose-600 hover:bg-rose-700 disabled:bg-gray-400 text-white font-bold py-2 px-4 rounded text-sm"
                >
                  {timecardCsvBusy ? "Working..." : "Create Timecard Entries"}
                </button>
                <button
                  onClick={handleDownloadTimecardJson}
                  disabled={timecardCsvRows.length === 0}
                  className="bg-white border border-rose-300 text-rose-800 hover:bg-rose-50 disabled:bg-gray-100 disabled:text-gray-400 font-semibold py-2 px-4 rounded text-sm"
                >
                  Download Converted JSON
                </button>
              </div>

              {timecardCsvSummary && (
                <p className="text-xs text-rose-800 mb-3">{timecardCsvSummary}</p>
              )}

              {timecardCsvError && (
                <div className="mb-3 bg-red-50 border border-red-300 text-red-700 px-3 py-2 rounded text-sm">
                  {timecardCsvError}
                </div>
              )}

              {timecardCsvResults && (
                <div className="mb-3 bg-rose-50 border border-rose-200 text-rose-900 px-3 py-2 rounded text-sm">
                  Created {timecardCsvResults.success} row(s); {timecardCsvResults.failed} failed.
                </div>
              )}

              {timecardCsvRows.length > 0 && (
                <div className="overflow-x-auto border border-gray-200 rounded">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left px-3 py-2">Row</th>
                        <th className="text-left px-3 py-2">Employee</th>
                        <th className="text-left px-3 py-2">Date</th>
                        <th className="text-left px-3 py-2">Hours</th>
                        <th className="text-left px-3 py-2">Cost Code</th>
                        <th className="text-left px-3 py-2">Time Type</th>
                        <th className="text-left px-3 py-2">Resolution</th>
                        <th className="text-left px-3 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {timecardCsvRows.map((row) => (
                        <tr key={row.rowNumber} className="border-t border-gray-200 align-top">
                          <td className="px-3 py-2 font-mono">{row.rowNumber}</td>
                          <td className="px-3 py-2">
                            <div>{String(row.source.employeeName || "") || "-"}</div>
                            <div className="text-xs text-gray-500">{row.resolvedPartyName || String(row.payload.party_id || "") || "unresolved"}</div>
                          </td>
                          <td className="px-3 py-2 font-mono">{String(row.source.date || "") || "-"}</td>
                          <td className="px-3 py-2 font-mono">{String(row.source.hours || "") || "-"}</td>
                          <td className="px-3 py-2">
                            <div className="font-mono">{String(row.source.costCodeLongNumber || "") || "-"}</div>
                            <div className="text-xs text-gray-500">{row.resolvedCostCodeName || String(row.payload.cost_code_id || "") || "unresolved"}</div>
                          </td>
                          <td className="px-3 py-2">
                            <div>{String(row.source.timeTypeName || "") || "-"}</div>
                            <div className="text-xs text-gray-500">{row.resolvedTimeTypeName || String(row.payload.timecard_time_type_id || "") || "unresolved"}</div>
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-700">
                            {row.resolutionNotes.length > 0 ? row.resolutionNotes.join(" ") : "Resolved"}
                          </td>
                          <td className="px-3 py-2 text-xs font-semibold">
                            <span
                              className={
                                row.status === "success"
                                  ? "text-green-700"
                                  : row.status === "error"
                                    ? "text-red-700"
                                    : row.resolved
                                      ? "text-rose-800"
                                      : "text-amber-700"
                              }
                            >
                              {row.statusMessage || row.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="bg-white rounded-lg shadow p-6 border-2 border-teal-500 mb-6">
              <h2 className="text-xl font-bold text-teal-900 mb-3">Create Purchase Order Contract</h2>
              <p className="text-sm text-gray-600 mb-4">
                Create a Procore purchase order contract through <code className="bg-gray-100 px-1 rounded">/api/procore/purchase-order-contracts/create</code>.
                Paste the contract JSON and optionally supply attachments as a JSON array.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Project ID</label>
                  <input
                    type="text"
                    value={purchaseOrderContractProjectId}
                    onChange={(e) => setPurchaseOrderContractProjectId(e.target.value)}
                    placeholder="e.g. 66005"
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                    <input
                      type="checkbox"
                      checked={purchaseOrderContractRunValidations}
                      onChange={(e) => setPurchaseOrderContractRunValidations(e.target.checked)}
                    />
                    Run configurable validations
                  </label>
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-semibold text-gray-700 mb-1">Attachments JSON Array</label>
                <textarea
                  value={purchaseOrderContractAttachmentsText}
                  onChange={(e) => setPurchaseOrderContractAttachmentsText(e.target.value)}
                  rows={3}
                  className="w-full border border-gray-400 rounded px-3 py-2 text-sm leading-6 font-mono text-gray-900 bg-white"
                />
              </div>

              <div className="mb-4">
                <label className="block text-sm font-semibold text-gray-700 mb-1">purchase_order_contract JSON</label>
                <textarea
                  value={purchaseOrderContractJsonText}
                  onChange={(e) => setPurchaseOrderContractJsonText(e.target.value)}
                  rows={16}
                  className="w-full border border-gray-400 rounded px-3 py-2 text-sm leading-6 font-mono text-gray-900 bg-white"
                />
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={handleCreatePurchaseOrderContract}
                  disabled={purchaseOrderContractBusy}
                  className="bg-teal-600 hover:bg-teal-700 disabled:bg-gray-400 text-white font-bold py-2 px-4 rounded text-sm"
                >
                  {purchaseOrderContractBusy ? "Creating..." : "Create Purchase Order Contract"}
                </button>
              </div>

              <div className="mt-4 pt-4 border-t border-teal-200">
                <h3 className="text-base font-bold text-teal-900 mb-2">Delete Commitment Contract</h3>
                <p className="text-sm text-gray-600 mb-3">
                  Calls <code className="bg-gray-100 px-1 rounded">DELETE /rest/v2.0/companies/&#123;company_id&#125;/projects/&#123;project_id&#125;/commitment_contracts/&#123;commitment_contract_id&#125;</code>
                  using your normal Procore auth/session.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Commitment Contract ID</label>
                    <input
                      type="text"
                      value={deletePurchaseOrderContractId}
                      onChange={(e) => setDeletePurchaseOrderContractId(e.target.value)}
                      placeholder="e.g. 598134328354823"
                      className="w-full border border-gray-300 rounded px-3 py-2 text-sm font-mono"
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      onClick={handleDeletePurchaseOrderContract}
                      disabled={deletePurchaseOrderContractBusy}
                      className="bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white font-bold py-2 px-4 rounded text-sm"
                    >
                      {deletePurchaseOrderContractBusy ? "Deleting..." : "Delete Commitment Contract"}
                    </button>
                  </div>
                </div>

                {deletePurchaseOrderContractError && (
                  <div className="mt-2 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
                    <strong>Delete Contract Error:</strong> {deletePurchaseOrderContractError}
                  </div>
                )}

                {deletePurchaseOrderContractResult && (
                  <pre className="mt-3 bg-gray-50 border border-gray-300 text-gray-900 p-4 rounded overflow-auto text-sm leading-6 font-mono">
                    {JSON.stringify(deletePurchaseOrderContractResult, null, 2)}
                  </pre>
                )}
              </div>

              {purchaseOrderContractError && (
                <div className="mt-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
                  <strong>Create PO Contract Error:</strong> {purchaseOrderContractError}
                </div>
              )}

              {purchaseOrderContractResult && (
                <pre className="mt-4 bg-gray-50 border border-gray-300 text-gray-900 p-4 rounded overflow-auto text-sm leading-6 font-mono">
                  {JSON.stringify(purchaseOrderContractResult, null, 2)}
                </pre>
              )}

              <div className="mt-8 pt-6 border-t border-teal-200">
                <h3 className="text-base font-bold text-teal-900 mb-1">Bulk Import from CSV</h3>
                <p className="text-sm text-gray-600 mb-3">
                  Upload a Productivity Log-style CSV and bulk-create draft purchase order contracts grouped by the <strong>Contract</strong> column.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={purchaseOrderContractCsvAllowPrivate}
                      onChange={(e) => setPurchaseOrderContractCsvAllowPrivate(e.target.checked)}
                    />
                    Honor CSV Private column (unchecked = force private false)
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={purchaseOrderContractCsvAllowUnitAccounting}
                      onChange={(e) => setPurchaseOrderContractCsvAllowUnitAccounting(e.target.checked)}
                    />
                    Honor CSV Accounting Method column (unchecked = force amount)
                  </label>
                </div>

                <div className="flex items-center gap-3 mb-3">
                  <label className="block text-sm font-semibold text-gray-700">Upload CSV</label>
                  <input
                    type="file"
                    accept=".csv"
                    onChange={handlePurchaseOrderContractCsvUpload}
                    className="border border-gray-300 rounded px-3 py-1.5 text-sm bg-white"
                  />
                </div>

                {purchaseOrderContractCsvSummary && (
                  <p className="text-xs text-teal-800 mb-3">{purchaseOrderContractCsvSummary}</p>
                )}

                {purchaseOrderContractCsvError && (
                  <div className="mb-3 bg-red-50 border border-red-300 text-red-700 px-3 py-2 rounded text-sm">
                    {purchaseOrderContractCsvError}
                  </div>
                )}

                {purchaseOrderContractCsvRows.some((row) => Boolean(row.payload.private)) && (
                  <div className="mb-3 bg-amber-50 border border-amber-300 text-amber-900 px-3 py-2 rounded text-sm">
                    Warning: One or more contracts are marked private and may not be visible in all daily/productivity workflows.
                  </div>
                )}

                {purchaseOrderContractCsvRows.length > 0 && (
                  <>
                    <div className="overflow-x-auto border border-gray-200 rounded mb-3">
                      <table className="min-w-full text-xs">
                        <thead className="bg-gray-100">
                          <tr>
                            <th className="px-2 py-1.5 text-left font-semibold text-gray-700">Contract #</th>
                            <th className="px-2 py-1.5 text-left font-semibold text-gray-700">Title</th>
                            <th className="px-2 py-1.5 text-left font-semibold text-gray-700">Vendor</th>
                            <th className="px-2 py-1.5 text-center font-semibold text-gray-700">Rows</th>
                            <th className="px-2 py-1.5 text-left font-semibold text-gray-700">Date</th>
                            <th className="px-2 py-1.5 text-center font-semibold text-gray-700">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {purchaseOrderContractCsvRows.map((row, i) => (
                            <tr
                              key={`${row.contractNumber}:${i}`}
                              className={
                                row.status === "success"
                                  ? "bg-green-50"
                                  : row.status === "error"
                                    ? "bg-red-50"
                                    : "bg-white"
                              }
                            >
                              <td className="px-2 py-1 border-t border-gray-100 font-mono">{row.contractNumber}</td>
                              <td className="px-2 py-1 border-t border-gray-100 max-w-sm truncate" title={row.contractTitle}>
                                {row.contractTitle}
                              </td>
                              <td className="px-2 py-1 border-t border-gray-100 max-w-xs truncate" title={row.vendorName}>
                                {row.vendorName || "ΓÇö"}
                              </td>
                              <td className="px-2 py-1 border-t border-gray-100 text-center">{row.rowCount}</td>
                              <td className="px-2 py-1 border-t border-gray-100 whitespace-nowrap">{row.contractDate || "ΓÇö"}</td>
                              <td className="px-2 py-1 border-t border-gray-100 text-center">
                                {row.status === "success" && (
                                  <span className="text-green-700 font-semibold">Γ£ô {row.statusMessage}</span>
                                )}
                                {row.status === "error" && (
                                  <span className="text-red-600" title={row.statusMessage}>Γ£ù Error</span>
                                )}
                                {row.status === "pending" && <span className="text-gray-500">Ready</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        onClick={handleBulkCreatePurchaseOrderContractsFromCsv}
                        disabled={purchaseOrderContractCsvBusy || purchaseOrderContractCsvRows.length === 0}
                        className="bg-teal-600 hover:bg-teal-700 disabled:bg-gray-400 text-white font-bold py-2 px-4 rounded text-sm"
                      >
                        {purchaseOrderContractCsvBusy
                          ? "Creating..."
                          : `Create ${purchaseOrderContractCsvRows.filter((r) => r.status === "pending").length} Contracts`}
                      </button>
                      {purchaseOrderContractCsvResults && (
                        <span className="text-sm font-semibold">
                          <span className="text-green-700">{purchaseOrderContractCsvResults.success} succeeded</span>
                          {purchaseOrderContractCsvResults.failed > 0 && (
                            <span className="text-red-600 ml-2">{purchaseOrderContractCsvResults.failed} failed</span>
                          )}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6 border-2 border-emerald-500 mb-6">
              <h2 className="text-xl font-bold text-emerald-900 mb-3">Create Purchase Order Contract Line Item</h2>
              <p className="text-sm text-gray-600 mb-4">
                Create a line item on an existing purchase order contract through <code className="bg-gray-100 px-1 rounded">/api/procore/purchase-order-contracts/line-items-create</code>.
              </p>
              <div className="mb-4 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Use <strong>manual</strong> line items for editable SOV behavior. The previous sample used <strong>calculated</strong>, which can land in a non-editable state in Procore.
              </div>
              <div className="mb-4 rounded border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
                This form accepts <strong>budget_line_item_id</strong>/<strong>budgetLineItemId</strong>, <strong>budget_code_id</strong>/<strong>budgetCodeId</strong>, and <strong>wbs_code_id</strong>/<strong>wbsCodeId</strong>. The route now forwards both <strong>budget_line_item_id</strong> and <strong>wbs_code_id</strong> when available.
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Project ID</label>
                  <input
                    type="text"
                    value={purchaseOrderLineItemProjectId}
                    onChange={(e) => setPurchaseOrderLineItemProjectId(e.target.value)}
                    placeholder="e.g. 66005"
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Purchase Order Contract ID</label>
                  <input
                    type="text"
                    value={purchaseOrderLineItemContractId}
                    onChange={(e) => setPurchaseOrderLineItemContractId(e.target.value)}
                    placeholder="e.g. 123456789"
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm font-mono"
                  />
                </div>
              </div>

              <div className="mb-4 rounded border border-emerald-200 bg-emerald-50 px-4 py-3">
                <div className="flex flex-wrap items-center gap-3 mb-2">
                  <button
                    onClick={handleLoadPurchaseOrderLineItemReferences}
                    disabled={purchaseOrderLineItemRefsBusy}
                    className="bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-400 text-white font-bold py-2 px-3 rounded text-xs"
                  >
                    {purchaseOrderLineItemRefsBusy ? "Loading Current Cost References..." : "Load Current Cost Codes & Cost Types"}
                  </button>
                  {purchaseOrderLineItemRefsSummary && (
                    <span className="text-xs text-emerald-900">{purchaseOrderLineItemRefsSummary}</span>
                  )}
                </div>

                {purchaseOrderLineItemRefsError && (
                  <div className="mb-2 text-xs text-red-700">{purchaseOrderLineItemRefsError}</div>
                )}

                {(purchaseOrderLineItemCostCodes.length > 0 || purchaseOrderLineItemCostTypes.length > 0) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    <div>
                      <div className="font-semibold text-gray-800 mb-1">Latest Project Cost Codes (first 10)</div>
                      <div className="border border-emerald-200 bg-white rounded p-2 max-h-32 overflow-auto font-mono">
                        {purchaseOrderLineItemCostCodes.slice(0, 10).map((row) => (
                          <div key={`cc-${row.id}`}>
                            {row.id} - {row.fullCode || "(no code)"} - {row.name || "(no name)"}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="font-semibold text-gray-800 mb-1">Latest Cost Types (first 10)</div>
                      <div className="border border-emerald-200 bg-white rounded p-2 max-h-32 overflow-auto font-mono">
                        {purchaseOrderLineItemCostTypes.slice(0, 10).map((row) => (
                          <div key={`ct-${row.id}`}>
                            {row.id} - {row.code || "(no code)"} - {row.name || "(no name)"}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="mb-4">
                <label className="block text-sm font-semibold text-gray-700 mb-1">line_item JSON</label>
                <textarea
                  value={purchaseOrderLineItemJsonText}
                  onChange={(e) => setPurchaseOrderLineItemJsonText(e.target.value)}
                  rows={14}
                  className="w-full border border-gray-400 rounded px-3 py-2 text-sm leading-6 font-mono text-gray-900 bg-white"
                />
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={handleCreatePurchaseOrderContractLineItem}
                  disabled={purchaseOrderLineItemBusy}
                  className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-400 text-white font-bold py-2 px-4 rounded text-sm"
                >
                  {purchaseOrderLineItemBusy ? "Creating..." : "Create PO Contract Line Item"}
                </button>
              </div>

              {purchaseOrderLineItemError && (
                <div className="mt-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
                  <strong>Create PO Line Item Error:</strong> {purchaseOrderLineItemError}
                </div>
              )}

              {purchaseOrderLineItemResult && (
                <pre className="mt-4 bg-gray-50 border border-gray-300 text-gray-900 p-4 rounded overflow-auto text-sm leading-6 font-mono">
                  {JSON.stringify(purchaseOrderLineItemResult, null, 2)}
                </pre>
              )}

              <div className="mt-8 pt-6 border-t border-emerald-200">
                <h3 className="text-base font-bold text-emerald-900 mb-1">Bulk Import from Estimate CSV</h3>
                <p className="text-sm text-gray-600 mb-3">
                  Upload estimate-format CSV with columns like <strong>Cost Code, Cost Type, Description, Quantity, UOM, Unit Price, Subtotal Override</strong>. Required columns <strong>project_id</strong> and <strong>purchase_order_contract_id</strong> let one file create line items across multiple projects/contracts in one run.
                </p>

                <div className="mb-3 p-3 rounded border border-emerald-200 bg-emerald-50">
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Cost Code/Type Mapping File (.xlsx/.xls/.csv)</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      onChange={handlePurchaseOrderLineItemMappingUpload}
                      className="border border-gray-300 rounded px-3 py-1.5 text-sm bg-white"
                    />
                    <button
                      type="button"
                      onClick={handleLoadPurchaseOrderLineItemMappingProfile}
                      disabled={purchaseOrderLineItemMappingProfileBusy}
                      className="bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-400 text-white font-bold py-1.5 px-3 rounded text-xs"
                    >
                      {purchaseOrderLineItemMappingProfileBusy ? "Loading Saved Table..." : "Load Saved Mapping Table"}
                    </button>
                    {purchaseOrderLineItemMappingBusy && <span className="text-xs text-gray-700">Loading mapping...</span>}
                  </div>
                  {purchaseOrderLineItemMappingSummary && (
                    <p className="mt-2 text-xs text-emerald-800">{purchaseOrderLineItemMappingSummary}</p>
                  )}
                  {purchaseOrderLineItemMappingProfileSummary && (
                    <p className="mt-2 text-xs text-emerald-900">{purchaseOrderLineItemMappingProfileSummary}</p>
                  )}
                  {purchaseOrderLineItemMappingError && (
                    <p className="mt-2 text-xs text-red-700">{purchaseOrderLineItemMappingError}</p>
                  )}
                  {purchaseOrderLineItemMappingProfileError && (
                    <p className="mt-2 text-xs text-red-700">{purchaseOrderLineItemMappingProfileError}</p>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Default line_item_type_id</label>
                    <input
                      type="text"
                      value={purchaseOrderLineItemCsvDefaultTypeId}
                      onChange={(e) => setPurchaseOrderLineItemCsvDefaultTypeId(e.target.value)}
                      placeholder="e.g. 5085801"
                      className="w-full border border-gray-300 rounded px-3 py-2 text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Default wbs_code_id</label>
                    <input
                      type="text"
                      value={purchaseOrderLineItemCsvDefaultWbsId}
                      onChange={(e) => setPurchaseOrderLineItemCsvDefaultWbsId(e.target.value)}
                      placeholder="optional"
                      className="w-full border border-gray-300 rounded px-3 py-2 text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Default budget_line_item_id</label>
                    <input
                      type="text"
                      value={purchaseOrderLineItemCsvDefaultBudgetLineItemId}
                      onChange={(e) => setPurchaseOrderLineItemCsvDefaultBudgetLineItemId(e.target.value)}
                      placeholder="optional"
                      className="w-full border border-gray-300 rounded px-3 py-2 text-sm font-mono"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3 mb-3">
                  <label className="block text-sm font-semibold text-gray-700">Upload CSV</label>
                  <input
                    type="file"
                    accept=".csv"
                    onChange={handlePurchaseOrderLineItemCsvUpload}
                    className="border border-gray-300 rounded px-3 py-1.5 text-sm bg-white"
                  />
                </div>

                {purchaseOrderLineItemCsvSummary && (
                  <p className="text-xs text-emerald-800 mb-3">{purchaseOrderLineItemCsvSummary}</p>
                )}

                {purchaseOrderLineItemCsvError && (
                  <div className="mb-3 bg-red-50 border border-red-300 text-red-700 px-3 py-2 rounded text-sm">
                    {purchaseOrderLineItemCsvError}
                  </div>
                )}

                {purchaseOrderLineItemCsvRows.length > 0 && (
                  <>
                    <div className="overflow-x-auto border border-gray-200 rounded mb-3">
                      <table className="min-w-full text-xs">
                        <thead className="bg-gray-100">
                          <tr>
                            <th className="px-2 py-1.5 text-left font-semibold text-gray-700">Project ID</th>
                            <th className="px-2 py-1.5 text-left font-semibold text-gray-700">PO Contract ID</th>
                            <th className="px-2 py-1.5 text-left font-semibold text-gray-700">Cost Code</th>
                            <th className="px-2 py-1.5 text-left font-semibold text-gray-700">Mapped Cost Code</th>
                            <th className="px-2 py-1.5 text-left font-semibold text-gray-700">Cost Type</th>
                            <th className="px-2 py-1.5 text-left font-semibold text-gray-700">Mapped Cost Type</th>
                            <th className="px-2 py-1.5 text-left font-semibold text-gray-700">Description</th>
                            <th className="px-2 py-1.5 text-right font-semibold text-gray-700">Qty</th>
                            <th className="px-2 py-1.5 text-left font-semibold text-gray-700">UOM</th>
                            <th className="px-2 py-1.5 text-right font-semibold text-gray-700">Unit Price</th>
                            <th className="px-2 py-1.5 text-right font-semibold text-gray-700">Amount</th>
                            <th className="px-2 py-1.5 text-center font-semibold text-gray-700">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {purchaseOrderLineItemCsvRows.map((row, i) => (
                            <tr
                              key={`${row.description}:${i}`}
                              className={
                                row.status === "success"
                                  ? "bg-green-50"
                                  : row.status === "error"
                                    ? "bg-red-50"
                                    : "bg-white"
                              }
                            >
                              <td className="px-2 py-1 border-t border-gray-100 font-mono">{row.projectId || "ΓÇö"}</td>
                              <td className="px-2 py-1 border-t border-gray-100 font-mono">{row.purchaseOrderContractId || "ΓÇö"}</td>
                              <td className="px-2 py-1 border-t border-gray-100 font-mono">{row.costCodeRaw || "ΓÇö"}</td>
                              <td className="px-2 py-1 border-t border-gray-100 font-mono">{row.mappedCostCode || row.costCodeRaw || "ΓÇö"}</td>
                              <td className="px-2 py-1 border-t border-gray-100">{row.costType || "ΓÇö"}</td>
                              <td className="px-2 py-1 border-t border-gray-100">{row.mappedCostType || row.costType || "ΓÇö"}</td>
                              <td className="px-2 py-1 border-t border-gray-100 max-w-sm truncate" title={row.description}>{row.description}</td>
                              <td className="px-2 py-1 border-t border-gray-100 text-right">{row.quantity}</td>
                              <td className="px-2 py-1 border-t border-gray-100">{row.uom}</td>
                              <td className="px-2 py-1 border-t border-gray-100 text-right">{row.unitPrice.toFixed(2)}</td>
                              <td className="px-2 py-1 border-t border-gray-100 text-right">{row.amount.toFixed(2)}</td>
                              <td className="px-2 py-1 border-t border-gray-100 text-center">
                                {row.status === "success" && <span className="text-green-700 font-semibold">Γ£ô {row.statusMessage}</span>}
                                {row.status === "error" && (
                                  <span className="text-red-600">
                                    Γ£ù Error
                                    {row.statusMessage && (
                                      <div className="text-xs mt-0.5 max-w-xs break-words">{row.statusMessage}</div>
                                    )}
                                  </span>
                                )}
                                {row.status === "pending" && <span className="text-gray-500">Ready</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        onClick={handleBulkCreatePurchaseOrderLineItemsFromCsv}
                        disabled={purchaseOrderLineItemCsvBusy || purchaseOrderLineItemCsvRows.length === 0}
                        className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-400 text-white font-bold py-2 px-4 rounded text-sm"
                      >
                        {purchaseOrderLineItemCsvBusy
                          ? "Creating..."
                          : `Create ${purchaseOrderLineItemCsvRows.filter((r) => r.status === "pending").length} Line Items`}
                      </button>
                      {purchaseOrderLineItemCsvResults && (
                        <span className="text-sm font-semibold">
                          <span className="text-green-700">{purchaseOrderLineItemCsvResults.success} succeeded</span>
                          {purchaseOrderLineItemCsvResults.failed > 0 && (
                            <span className="text-red-600 ml-2">{purchaseOrderLineItemCsvResults.failed} failed</span>
                          )}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
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
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Approved Contract Line Items</label>
                  <div className="flex gap-2">
                    <button
                      onClick={handleLoadValidProductivityLineItems}
                      disabled={createProductivityLineItemsBusy}
                      className="bg-cyan-100 hover:bg-cyan-200 disabled:bg-gray-200 text-cyan-900 font-semibold py-2 px-3 rounded text-sm border border-cyan-300"
                    >
                      {createProductivityLineItemsBusy ? "Loading..." : "Load Approved Line Items"}
                    </button>
                    <select
                      value={createProductivitySelectedLineItemKey}
                      onChange={(e) => {
                        const selectedKey = e.target.value;
                        setCreateProductivitySelectedLineItemKey(selectedKey);
                        const selectedItem = createProductivityLineItems.find(
                          (item) => getProductivityLineItemKey(item) === selectedKey
                        );
                        if (selectedItem) {
                          applyProductivityLineItemIdToJson(selectedItem.line_item_id);
                        }
                      }}
                      disabled={createProductivityLineItemsBusy}
                      className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm bg-white"
                    >
                      <option value="" disabled>
                        {createProductivityLineItems.length === 0
                          ? "Load approved line items first"
                          : "Select line item"}
                      </option>
                      {createProductivityLineItems.map((item) => (
                        <option
                          key={getProductivityLineItemKey(item)}
                          value={getProductivityLineItemKey(item)}
                        >
                          {item.line_item_id} | {item.contract_type === "commitment_contract" ? "CMT" : item.contract_type === "work_order_contract" ? "WO" : "PO"} {item.contract_number || item.contract_id} | {item.description || "No description"}
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Loads line items from approved commitment, Work Order, and Purchase Order contracts for this project and updates <strong>line_item_id</strong> in JSON.
                  </p>
                  {createProductivityLineItemsInfo && (
                    <p className="text-xs text-cyan-800 mt-1">{createProductivityLineItemsInfo}</p>
                  )}
                </div>
              </div>

              {createProductivityLineItemsError && (
                <div className="mb-4 bg-amber-100 border border-amber-400 text-amber-900 px-4 py-3 rounded text-sm">
                  <strong>Line Item Lookup:</strong> {createProductivityLineItemsError}
                </div>
              )}

              {createProductivityLineItemsDebug && (
                <div className="mb-4 bg-gray-50 border border-gray-300 rounded p-4 text-sm">
                  <details className="cursor-pointer">
                    <summary className="font-semibold text-gray-800 mb-2">Debug: Contract Details</summary>
                    <pre className="bg-white border border-gray-200 rounded p-3 overflow-auto text-xs leading-5 font-mono text-gray-700">
                      {JSON.stringify(createProductivityLineItemsDebug, null, 2)}
                    </pre>
                  </details>
                </div>
              )}

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

              {/* CSV Bulk Import */}
              <div className="mt-8 pt-6 border-t border-cyan-200">
                <h3 className="text-base font-bold text-cyan-900 mb-1">Bulk Import from CSV</h3>
                <p className="text-sm text-gray-600 mb-3">
                  Upload a Procore-exported Productivity Log CSV. Rows are automatically matched to loaded line items by contract number and line item number (e.g. PO-009 + #1).
                  Load approved line items first for auto-matching to work.
                </p>

                <div className="flex items-center gap-3 mb-3">
                  <label className="block text-sm font-semibold text-gray-700">Upload CSV</label>
                  <input
                    type="file"
                    accept=".csv"
                    onChange={handleCsvFileUpload}
                    className="border border-gray-300 rounded px-3 py-1.5 text-sm bg-white"
                  />
                </div>

                {csvImportSummary && (
                  <p className="text-xs text-cyan-800 mb-3">{csvImportSummary}</p>
                )}
                {csvImportError && (
                  <div className="mb-3 bg-red-50 border border-red-300 text-red-700 px-3 py-2 rounded text-sm">
                    {csvImportError}
                  </div>
                )}

                {csvImportRows.length > 0 && (
                  <>
                    <div className="overflow-x-auto border border-gray-200 rounded mb-3">
                      <table className="min-w-full text-xs">
                        <thead className="bg-gray-100">
                          <tr>
                            <th className="px-2 py-1.5 text-left font-semibold text-gray-700">Date</th>
                            <th className="px-2 py-1.5 text-left font-semibold text-gray-700">Contract</th>
                            <th className="px-2 py-1.5 text-left font-semibold text-gray-700">Line Item</th>
                            <th className="px-2 py-1.5 text-right font-semibold text-gray-700">Qty Delivered</th>
                            <th className="px-2 py-1.5 text-left font-semibold text-gray-700">Notes</th>
                            <th className="px-2 py-1.5 text-center font-semibold text-gray-700">Line Item ID</th>
                            <th className="px-2 py-1.5 text-center font-semibold text-gray-700">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {csvImportRows.map((row, i) => (
                            <tr key={i} className={row._status === "success" ? "bg-green-50" : row._status === "error" ? "bg-red-50" : row._matched ? "bg-white" : "bg-yellow-50"}>
                              <td className="px-2 py-1 border-t border-gray-100 whitespace-nowrap">{row.date}</td>
                              <td className="px-2 py-1 border-t border-gray-100 max-w-xs truncate" title={row._csv_contract}>{row._csv_contract.split(" - ")[0]}</td>
                              <td className="px-2 py-1 border-t border-gray-100 max-w-xs truncate" title={row._csv_line_item}>{row._csv_line_item.substring(0, 30)}</td>
                              <td className="px-2 py-1 border-t border-gray-100 text-right">{row.quantity_delivered ?? "ΓÇö"}</td>
                              <td className="px-2 py-1 border-t border-gray-100 max-w-xs truncate" title={row.notes}>{row.notes || ""}</td>
                              <td className="px-2 py-1 border-t border-gray-100 text-center font-mono">
                                {row._matched ? (
                                  <span className="text-green-700">{row.line_item_id}</span>
                                ) : (
                                  <span className="text-yellow-700">unmatched</span>
                                )}
                              </td>
                              <td className="px-2 py-1 border-t border-gray-100 text-center">
                                {row._status === "success" && <span className="text-green-700 font-semibold">Γ£ô {row._statusMessage}</span>}
                                {row._status === "error" && <span className="text-red-600" title={row._statusMessage}>Γ£ù Error</span>}
                                {row._status === "pending" && !row._matched && <span className="text-yellow-600">No match</span>}
                                {row._status === "pending" && row._matched && <span className="text-gray-400">Ready</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        onClick={() => {
                          const rematched = autoMatchCsvRows(csvImportRows);
                          setCsvImportRows(rematched);
                          const matchCount = rematched.filter((r) => r._matched).length;
                          setCsvImportSummary(`${csvImportRows.length} row(s). ${matchCount} matched, ${csvImportRows.length - matchCount} unmatched.`);
                        }}
                        disabled={csvImportBusy}
                        className="bg-gray-100 hover:bg-gray-200 disabled:bg-gray-200 text-gray-800 font-semibold py-2 px-3 rounded text-sm border border-gray-300"
                      >
                        Re-match
                      </button>
                      <button
                        onClick={handleCsvBulkSubmit}
                        disabled={csvImportBusy || csvImportRows.filter((r) => r._matched).length === 0}
                        className="bg-cyan-600 hover:bg-cyan-700 disabled:bg-gray-400 text-white font-bold py-2 px-4 rounded text-sm"
                      >
                        {csvImportBusy
                          ? "Submitting..."
                          : `Submit ${csvImportRows.filter((r) => r._matched && r._status === "pending").length} Matched Rows`}
                      </button>
                      {csvImportResults && (
                        <span className="text-sm font-semibold">
                          <span className="text-green-700">{csvImportResults.success} succeeded</span>
                          {csvImportResults.failed > 0 && <span className="text-red-600 ml-2">{csvImportResults.failed} failed</span>}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
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

            <div className="bg-white rounded-lg shadow p-6 border-2 border-sky-500 mb-6">
              <h2 className="text-xl font-bold text-sky-900 mb-3">Estimate Pull (Full Proposal Show)</h2>
              <p className="text-sm text-gray-600 mb-4">
                Pull the full proposal payload from <code className="bg-gray-100 px-1 rounded">/rest/v2.0/companies/&#123;company_id&#125;/projects/&#123;project_id&#125;/estimating/proposals/&#123;proposal_id&#125;</code>.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Project ID</label>
                  <input
                    type="text"
                    value={proposalShowProjectId}
                    onChange={(e) => setProposalShowProjectId(e.target.value)}
                    placeholder="e.g. 598134326278124"
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Bid Board Project ID</label>
                  <input
                    type="text"
                    value={proposalShowBidBoardProjectId}
                    onChange={(e) => setProposalShowBidBoardProjectId(e.target.value)}
                    placeholder="Optional fallback if project-scoped pull is empty"
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Proposal ID</label>
                  <input
                    type="text"
                    value={proposalShowProposalId}
                    onChange={(e) => setProposalShowProposalId(e.target.value)}
                    placeholder="e.g. 123456"
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={handlePullProposalShow}
                  disabled={proposalShowBusy || proposalCsvBusy}
                  className="bg-sky-600 hover:bg-sky-700 disabled:bg-gray-400 text-white font-bold py-2 px-4 rounded text-sm"
                >
                  {proposalShowBusy ? "Pulling..." : "Pull Full Proposal"}
                </button>
                <button
                  onClick={handleExportProposalCsv}
                  disabled={proposalShowBusy || proposalCsvBusy}
                  className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-400 text-white font-bold py-2 px-4 rounded text-sm"
                >
                  {proposalCsvBusy ? "Exporting..." : "Download CSV Export"}
                </button>
              </div>

              {proposalShowError && (
                <div className="mt-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
                  <strong>Proposal Pull Error:</strong> {proposalShowError}
                </div>
              )}

              {proposalShowResult && (
                <div className="mt-4">
                  <div className="bg-sky-50 border border-sky-200 text-sky-900 px-4 py-3 rounded mb-3">
                    <strong>Proposal Pull Result:</strong> {proposalShowResult.ok ? "Success" : "Failed"}
                  </div>
                  <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 px-4 py-3 rounded mb-3">
                    <strong>CSV Export:</strong>{" "}
                    {Array.isArray(proposalShowResult.result?.lineItems)
                      ? `${proposalShowResult.result.lineItems.length} line item(s) ready for export.`
                      : "Pull with a Bid Board Project ID to populate line items for export."}
                  </div>
                  <pre className="bg-gray-50 border border-gray-300 text-gray-900 p-4 rounded overflow-auto text-sm leading-6 font-mono">
                    {JSON.stringify(proposalShowResult, null, 2)}
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

            <div className="bg-white rounded-lg shadow p-6 border-2 border-amber-500 mb-6">
              <h2 className="text-xl font-bold text-amber-900 mb-3">Estimate Key Conversion (Old -&gt; New)</h2>
              <p className="text-sm text-gray-600 mb-4">
                Convert an old estimate CSV to new Cost Code + ItemId values using the catalog crosswalk.
                If no crosswalk file is uploaded, the server uses <code className="bg-gray-100 px-1 rounded">catalog_lookup_crosswalk.csv</code> from project root/public.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Estimate CSV (.csv)</label>
                  <input type="file" accept=".csv,text/csv" onChange={handleEstimateCsvUpload} className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-white" />
                  <p className="text-xs text-amber-700 mt-2">{estimateCsvFileName ? `Loaded: ${estimateCsvFileName}` : "No estimate CSV loaded."}</p>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Crosswalk CSV (Optional)</label>
                  <input type="file" accept=".csv,text/csv" onChange={handleCrosswalkCsvUpload} className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-white" />
                  <p className="text-xs text-amber-700 mt-2">{crosswalkCsvFileName ? `Loaded: ${crosswalkCsvFileName}` : "Using server default crosswalk file if available."}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Cost Code Column (Optional)</label>
                  <input type="text" value={estimateCostCodeColumn} onChange={(e) => setEstimateCostCodeColumn(e.target.value)} placeholder="Auto-detect if blank" className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Item ID Column (Optional)</label>
                  <input type="text" value={estimateItemIdColumn} onChange={(e) => setEstimateItemIdColumn(e.target.value)} placeholder="Auto-detect if blank" className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
                </div>
              </div>

              <div className="flex gap-3 mb-4">
                <button onClick={handleConvertEstimateCsv} disabled={estimateConversionBusy} className="bg-amber-600 hover:bg-amber-700 disabled:bg-gray-400 text-white font-bold py-2 px-4 rounded text-sm">
                  {estimateConversionBusy ? "Converting..." : "Convert + Download CSVs"}
                </button>
              </div>

              {estimateConversionError && (
                <div className="mt-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
                  <strong>Conversion Error:</strong> {estimateConversionError}
                </div>
              )}

              {estimateConversionResult && (
                <div className="mt-4 bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3 rounded text-sm">
                  <strong>Conversion Result:</strong> {estimateConversionResult.rowsMatched ?? 0} matched, {estimateConversionResult.rowsUnmatched ?? 0} unmatched, {estimateConversionResult.rowsTotal ?? 0} total.
                  {" "}Detected columns: cost code <strong>{estimateConversionResult.detectedColumns?.costCodeColumn || "n/a"}</strong>, item ID <strong>{estimateConversionResult.detectedColumns?.itemIdColumn || "n/a"}</strong>.
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
                  ≡ƒöì Data Source Diagnostic Results
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
                    ≡ƒæñ User Info
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
                    ≡ƒÅó Companies ({getCount(data.companies)})
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
                    ≡ƒôï All Projects (Merged: {getCount(data.unifiedProjects)})
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
                    ≡ƒÅ¡ Vendors ({getCount(data.vendors)})
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
                    ≡ƒæÑ Users ({getCount(data.users)})
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
                    ≡ƒÆ░ Bid Board ({getCount(data.bidBoardProjects)}) / Est ({getCount(data.estimatingProjects)})
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
                    ≡ƒÆ╕ Bid Board v2.0 ({getCount(data.bidBoardV2)})
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
                    ≡ƒôæ Project Templates ({getCount(data.projectTemplates)})
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
                    ≡ƒôê Productivity Logs (Sample from {data.productivityLogs?.length || 0} Projects)
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
                      ≡ƒÅù∩╕Å Giant #6582: Specific Productivity Data (Last 90 Days)
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
