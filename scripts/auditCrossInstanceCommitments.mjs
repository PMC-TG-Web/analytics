import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const apiUrl = process.env.PROCORE_API_URL;
const tokenUrl = process.env.PROCORE_TOKEN_URL;
const sourceCompanyId =
  process.env.COMMITMENT_AUDIT_OLD_COMPANY_ID || "598134325658789";
const targetCompanyId =
  process.env.COMMITMENT_AUDIT_NEW_COMPANY_ID || "598134325805519";
const onlyTargetIds = new Set(
  String(process.env.COMMITMENT_AUDIT_TARGET_PROJECT_IDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

if (!apiUrl || !tokenUrl) {
  throw new Error("PROCORE_API_URL and PROCORE_TOKEN_URL are required.");
}

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const record = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
const text = (value) => String(value ?? "").trim();
const normalized = (value) => text(value).toLowerCase().replace(/\s+/g, " ");
const compact = (value) => normalized(value).replace(/[^a-z0-9]+/g, "");
const numeric = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const normalizedNumber = (value) => {
  const parsed = numeric(value);
  return parsed === null ? normalized(value) : String(Math.round(parsed * 1e6) / 1e6);
};

let accessToken = "";
let requestCount = 0;
let rateLimitWaits = 0;

async function getAccessToken() {
  if (accessToken) return accessToken;
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.PROCORE_CLIENT_ID || "",
      client_secret: process.env.PROCORE_CLIENT_SECRET || "",
    }),
  });
  if (!response.ok) {
    throw new Error(`Procore token request failed (${response.status}).`);
  }
  accessToken = text((await response.json()).access_token);
  if (!accessToken) {
    throw new Error("Procore token response did not include an access token.");
  }
  return accessToken;
}

async function procoreRequest({ companyId, path }) {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const token = await getAccessToken();
    const url = new URL(`${apiUrl}${path}`);
    requestCount += 1;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Procore-Company-Id": companyId,
        Accept: "application/json",
      },
    });
    if (response.status === 401) {
      accessToken = "";
      continue;
    }
    if (response.status === 429) {
      rateLimitWaits += 1;
      const resetAt = Number(response.headers.get("x-rate-limit-reset") || 0);
      const retryAfter = Number(response.headers.get("retry-after") || 0);
      const waitMs = Math.max(
        5_000,
        resetAt > 0 ? resetAt * 1_000 - Date.now() + 2_000 : 0,
        retryAfter > 0 ? retryAfter * 1_000 + 2_000 : 0,
      );
      console.log(
        JSON.stringify({
          event: "rate_limit_wait",
          companyId,
          attempt,
          waitSeconds: Math.ceil(waitMs / 1_000),
        }),
      );
      await sleep(waitMs);
      continue;
    }
    if (response.status >= 500 && attempt < 20) {
      await sleep(Math.min(30_000, attempt * 2_000));
      continue;
    }
    return response;
  }
  throw new Error(`GET ${path} exhausted retries.`);
}

function unwrapArray(value, keys = []) {
  if (Array.isArray(value)) return value;
  const holder = record(value);
  for (const key of [...keys, "data", "results"]) {
    if (Array.isArray(holder[key])) return holder[key];
  }
  return [];
}

async function fetchPaged({
  companyId,
  pathForPage,
  keys = [],
  allowMissing = false,
}) {
  const rows = [];
  const seenPageSignatures = new Set();
  for (let page = 1; page <= 100; page += 1) {
    const path = pathForPage(page);
    const response = await procoreRequest({ companyId, path });
    if (allowMissing && [400, 404, 405].includes(response.status)) {
      return { ok: false, status: response.status, rows: [], path };
    }
    if (!response.ok) {
      throw new Error(
        `GET ${path} failed (${response.status}): ${await response.text()}`,
      );
    }
    const pageRows = unwrapArray(await response.json(), keys);
    const pageSignature = pageRows
      .map((row) => text(record(row).id))
      .filter(Boolean)
      .join(",");
    if (pageSignature && seenPageSignatures.has(pageSignature)) {
      console.log(
        JSON.stringify({
          event: "pagination_repeat_stop",
          companyId,
          page,
          path,
          repeatedRows: pageRows.length,
        }),
      );
      break;
    }
    if (pageSignature) seenPageSignatures.add(pageSignature);
    rows.push(...pageRows);
    if (pageRows.length < 100) break;
    await sleep(150);
  }
  return { ok: true, status: 200, rows };
}

async function fetchProjects(companyId) {
  return (
    await fetchPaged({
      companyId,
      pathForPage: (page) =>
        `/rest/v1.0/projects?company_id=${encodeURIComponent(companyId)}&page=${page}&per_page=100`,
      keys: ["projects"],
    })
  ).rows;
}

function pairProjects(sourceProjects, targetProjects) {
  const sourceById = new Map(
    sourceProjects.map((project) => [text(project.id), project]),
  );
  const sourceByNumber = new Map();
  const sourceByName = new Map();

  for (const project of sourceProjects) {
    const numberKey = compact(project.project_number);
    const nameKey = normalized(project.name);
    if (numberKey) {
      const rows = sourceByNumber.get(numberKey) || [];
      rows.push(project);
      sourceByNumber.set(numberKey, rows);
    }
    if (nameKey) {
      const rows = sourceByName.get(nameKey) || [];
      rows.push(project);
      sourceByName.set(nameKey, rows);
    }
  }

  const knownPairs = new Map([
    ["598134326661398", "598134326065265"],
    ["598134326634377", "598134326326515"],
    ["598134326661486", "598134326375694"],
    ["598134326662203", "598134326378317"],
    ["598134326661426", "598134326435137"],
    ["598134326662409", "598134326529817"],
    ["598134326674594", "598134326377721"],
    ["598134326662485", "598134326529838"],
    ["598134326649802", "598134326362845"],
    ["598134326628693", "598134326601975"],
    ["598134326664197", "598134326370224"],
    ["598134326667403", "598134326198819"],
    ["598134326663551", "598134326602847"],
    ["598134326662286", "598134326559089"],
    ["598134326634438", "598134326376806"],
    ["598134326660487", "598134326244841"],
    ["598134326664157", "598134326340929"],
    ["598134326683024", "598134326362861"],
    ["598134326664181", "598134326377122"],
    ["598134326662430", "598134326378325"],
    ["598134326659649", "598134326371118"],
    ["598134326663850", "598134326601978"],
  ]);

  const pairs = [];
  const unmatched = [];
  for (const target of targetProjects) {
    const targetId = text(target.id);
    if (onlyTargetIds.size > 0 && !onlyTargetIds.has(targetId)) continue;
    const knownSource = sourceById.get(knownPairs.get(targetId));
    const numberMatches =
      sourceByNumber.get(compact(target.project_number)) || [];
    const nameMatches = sourceByName.get(normalized(target.name)) || [];
    const source =
      knownSource ||
      (numberMatches.length === 1 ? numberMatches[0] : null) ||
      (nameMatches.length === 1 ? nameMatches[0] : null);
    if (!source) {
      unmatched.push({
        targetProjectId: targetId,
        projectNumber: text(target.project_number),
        projectName: text(target.name),
      });
      continue;
    }
    pairs.push({
      source,
      target,
      match: knownSource
        ? "known_pair"
        : numberMatches.length === 1
          ? "project_number"
          : "project_name",
    });
  }
  return { pairs, unmatched };
}

async function fetchContracts(companyId, projectId) {
  return (
    await fetchPaged({
      companyId,
      pathForPage: (page) =>
        `/rest/v2.0/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(projectId)}/commitment_contracts?page=${page}&per_page=100`,
      keys: ["commitment_contracts"],
    })
  ).rows;
}

async function fetchLines(companyId, projectId, contractId) {
  const encodedCompany = encodeURIComponent(companyId);
  const encodedProject = encodeURIComponent(projectId);
  const encodedContract = encodeURIComponent(contractId);
  const v2 = await fetchPaged({
    companyId,
    pathForPage: (page) =>
      `/rest/v2.0/companies/${encodedCompany}/projects/${encodedProject}/commitment_contracts/${encodedContract}/line_items?page=${page}&per_page=100`,
    keys: ["line_items"],
    allowMissing: true,
  });

  if (v2.ok && v2.rows.length > 0) {
    return { rows: v2.rows, endpoint: "v2_line_items", fallback: null };
  }

  const v1Items = await fetchPaged({
    companyId,
    pathForPage: (page) =>
      `/rest/v1.0/purchase_order_contracts/${encodedContract}/line_items?company_id=${encodedCompany}&project_id=${encodedProject}&page=${page}&per_page=100`,
    keys: ["line_items"],
    allowMissing: true,
  });
  if (v1Items.ok && v1Items.rows.length > 0) {
    return {
      rows: v1Items.rows,
      endpoint: "v1_line_items",
      fallback: { v2Status: v2.status, v2Count: v2.rows.length },
    };
  }

  const v1Details = await fetchPaged({
    companyId,
    pathForPage: (page) =>
      `/rest/v1.0/purchase_order_contracts/${encodedContract}/line_item_contract_details?company_id=${encodedCompany}&project_id=${encodedProject}&page=${page}&per_page=100`,
    keys: ["line_item_contract_details", "line_items"],
    allowMissing: true,
  });
  return {
    rows: v1Details.rows,
    endpoint: v1Details.ok
      ? "v1_line_item_contract_details"
      : v2.ok
        ? "v2_line_items"
        : "none",
    fallback: {
      v2Status: v2.status,
      v2Count: v2.rows.length,
      v1ItemsStatus: v1Items.status,
      v1ItemsCount: v1Items.rows.length,
      v1DetailsStatus: v1Details.status,
      v1DetailsCount: v1Details.rows.length,
    },
  };
}

function originIds(row) {
  const ids = new Set();
  for (const value of [row.origin_id, row.originId]) {
    if (text(value)) ids.add(text(value));
  }
  const originData = text(row.origin_data || row.originData);
  for (const match of originData.match(/\d{6,}/g) || []) ids.add(match);
  return ids;
}

function contractKey(row) {
  return `${normalized(row.number)}|${normalized(row.title)}`;
}

function contractNumberKey(row) {
  return compact(row.number);
}

function contractTitleKey(row) {
  return normalized(row.title);
}

function titlesSafelyMatch(source, target) {
  const sourceTitle = contractTitleKey(source);
  const targetTitle = contractTitleKey(target);
  if (!sourceTitle || !targetTitle) return false;
  return (
    sourceTitle === targetTitle ||
    targetTitle.startsWith(`${sourceTitle} - `) ||
    sourceTitle.startsWith(`${targetTitle} - `)
  );
}

function matchContracts(sourceRows, targetRows) {
  const available = new Set(targetRows.map((_, index) => index));
  const matches = [];
  const missing = [];

  for (const source of sourceRows) {
    const sourceId = text(source.id);
    let targetIndex = [...available].find((index) =>
      originIds(targetRows[index]).has(sourceId),
    );
    let reason = "origin_id";

    if (targetIndex === undefined) {
      const exact = [...available].filter(
        (index) => contractKey(targetRows[index]) === contractKey(source),
      );
      if (exact.length === 1) {
        [targetIndex] = exact;
        reason = "number_title";
      }
    }
    if (targetIndex === undefined) {
      const sameTitle = [...available].filter((index) =>
        titlesSafelyMatch(source, targetRows[index]),
      );
      if (sameTitle.length === 1) {
        [targetIndex] = sameTitle;
        reason = "title";
      }
    }
    if (targetIndex === undefined) {
      const sameNumber = [...available].filter(
        (index) =>
          contractNumberKey(source) &&
          contractNumberKey(targetRows[index]) === contractNumberKey(source),
      );
      if (sameNumber.length === 1) {
        [targetIndex] = sameNumber;
        reason = "number";
      }
    }

    if (targetIndex === undefined) {
      missing.push(source);
      continue;
    }
    available.delete(targetIndex);
    matches.push({ source, target: targetRows[targetIndex], reason });
  }

  return {
    matches,
    missing,
    targetOnly: [...available].map((index) => targetRows[index]),
  };
}

function lineDescription(row) {
  return normalized(row.description || row.title || row.name);
}

function nestedText(row, key, fields) {
  const nested = record(row[key]);
  for (const field of fields) {
    if (text(nested[field])) return text(nested[field]);
  }
  return "";
}

function lineCostCode(row) {
  return normalized(
    nestedText(row, "cost_code", ["full_code", "code", "name"]) ||
      row.cost_code_full_code ||
      row.cost_code,
  ).replace(/\.l$/, "");
}

function lineUom(row) {
  return normalized(
    nestedText(row, "unit_of_measure", ["name", "abbreviation"]) ||
      row.uom ||
      row.unit_of_measure_name,
  );
}

function lineExactKey(row) {
  return [
    lineDescription(row),
    lineCostCode(row),
    lineUom(row),
    normalizedNumber(row.quantity),
    normalizedNumber(row.unit_cost ?? row.unit_price),
    normalizedNumber(row.amount ?? row.total),
  ].join("|");
}

function lineFinancialKey(row) {
  return [
    lineUom(row),
    normalizedNumber(row.quantity),
    normalizedNumber(row.unit_cost ?? row.unit_price),
    normalizedNumber(row.amount ?? row.total),
  ].join("|");
}

function hasMeaningfulFinancialIdentity(row) {
  return [
    numeric(row.quantity),
    numeric(row.unit_cost ?? row.unit_price),
    numeric(row.amount ?? row.total),
  ].some((value) => value !== null && Math.abs(value) > 0.000001);
}

function linePosition(row) {
  return normalizedNumber(
    row.position ?? row.line_number ?? row.line_item_number,
  );
}

function matchLines(sourceRows, targetRows) {
  const available = new Set(targetRows.map((_, index) => index));
  const matches = [];
  const missing = [];

  for (const source of sourceRows) {
    const sourceId = text(source.id);
    let targetIndex = [...available].find((index) =>
      originIds(targetRows[index]).has(sourceId),
    );
    let reason = "origin_id";

    if (targetIndex === undefined) {
      const exact = [...available].filter(
        (index) => lineExactKey(targetRows[index]) === lineExactKey(source),
      );
      if (exact.length === 1) {
        [targetIndex] = exact;
        reason = "exact_business_fields";
      }
    }
    if (targetIndex === undefined) {
      const positionAndDescription = [...available].filter(
        (index) =>
          lineDescription(targetRows[index]) === lineDescription(source) &&
          linePosition(source) &&
          linePosition(targetRows[index]) === linePosition(source),
      );
      if (positionAndDescription.length === 1) {
        [targetIndex] = positionAndDescription;
        reason = "position_description";
      }
    }
    if (targetIndex === undefined && hasMeaningfulFinancialIdentity(source)) {
      const positionAndFinancials = [...available].filter(
        (index) =>
          linePosition(source) &&
          linePosition(targetRows[index]) === linePosition(source) &&
          lineFinancialKey(targetRows[index]) === lineFinancialKey(source),
      );
      if (positionAndFinancials.length === 1) {
        [targetIndex] = positionAndFinancials;
        reason = "position_financials";
      }
    }
    if (targetIndex === undefined && hasMeaningfulFinancialIdentity(source)) {
      const financials = [...available].filter(
        (index) =>
          lineFinancialKey(targetRows[index]) === lineFinancialKey(source),
      );
      if (financials.length === 1) {
        [targetIndex] = financials;
        reason = "financials";
      }
    }
    if (targetIndex === undefined) {
      const description = [...available].filter(
        (index) =>
          lineDescription(source) &&
          lineDescription(targetRows[index]) === lineDescription(source),
      );
      if (description.length === 1) {
        [targetIndex] = description;
        reason = "description";
      }
    }

    if (targetIndex === undefined) {
      missing.push(source);
      continue;
    }
    available.delete(targetIndex);
    matches.push({ source, target: targetRows[targetIndex], reason });
  }

  return {
    matches,
    missing,
    targetOnly: [...available].map((index) => targetRows[index]),
  };
}

function comparableValue(row, field) {
  if (field === "description") return lineDescription(row);
  if (field === "costCode") return lineCostCode(row);
  if (field === "uom") return lineUom(row);
  if (field === "position") return linePosition(row);
  if (field === "quantity") return normalizedNumber(row.quantity);
  if (field === "unitCost") {
    return normalizedNumber(row.unit_cost ?? row.unit_price);
  }
  if (field === "amount") return normalizedNumber(row.amount ?? row.total);
  return "";
}

function lineDifferences(source, target) {
  return [
    "position",
    "description",
    "costCode",
    "uom",
    "quantity",
    "unitCost",
    "amount",
  ]
    .map((field) => ({
      field,
      source: comparableValue(source, field),
      target: comparableValue(target, field),
    }))
    .filter((difference) => difference.source !== difference.target);
}

function summarizeContract(row) {
  return {
    id: text(row.id),
    number: text(row.number),
    title: text(row.title),
    status: text(row.status),
    type: text(row.type),
    vendorId: text(
      row.vendor_id ||
        row.contract_company_id ||
        nestedText(row, "vendor", ["id"]) ||
        nestedText(row, "contract_company", ["id"]),
    ),
    vendor: text(
      nestedText(row, "vendor", ["name"]) ||
        nestedText(row, "vendor", ["company"]) ||
        nestedText(row, "contract_company", ["name"]) ||
        row.vendor_name,
    ),
    originIds: [...originIds(row)],
  };
}

function summarizeLine(row) {
  return {
    id: text(row.id),
    position: row.position ?? row.line_number ?? null,
    description: text(row.description || row.title || row.name),
    costCode: lineCostCode(row),
    uom: lineUom(row),
    quantity: numeric(row.quantity),
    unitCost: numeric(row.unit_cost ?? row.unit_price),
    amount: numeric(row.amount ?? row.total),
    originIds: [...originIds(row)],
  };
}

function duplicateGroups(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key || /^\|*$/.test(key)) continue;
    const bucket = groups.get(key) || [];
    bucket.push(row);
    groups.set(key, bucket);
  }
  return [...groups.entries()]
    .filter(([, bucket]) => bucket.length > 1)
    .map(([key, bucket]) => ({ key, rows: bucket }));
}

async function auditProject(pair, index, total) {
  const sourceProjectId = text(pair.source.id);
  const targetProjectId = text(pair.target.id);
  const [sourceContracts, targetContracts] = await Promise.all([
    fetchContracts(sourceCompanyId, sourceProjectId),
    fetchContracts(targetCompanyId, targetProjectId),
  ]);
  const contractAudit = matchContracts(sourceContracts, targetContracts);
  const contractResults = [];
  const sourceProjectLines = [];
  const targetProjectLines = [];

  for (const [contractIndex, match] of contractAudit.matches.entries()) {
    const [sourceLineResult, targetLineResult] = await Promise.all([
      fetchLines(sourceCompanyId, sourceProjectId, text(match.source.id)),
      fetchLines(targetCompanyId, targetProjectId, text(match.target.id)),
    ]);
    sourceProjectLines.push(...sourceLineResult.rows);
    targetProjectLines.push(...targetLineResult.rows);
    const lineAudit = matchLines(sourceLineResult.rows, targetLineResult.rows);
    const matchedLineDifferences = lineAudit.matches
      .map((lineMatch) => ({
        source: summarizeLine(lineMatch.source),
        target: summarizeLine(lineMatch.target),
        match: lineMatch.reason,
        differences: lineDifferences(lineMatch.source, lineMatch.target),
      }))
      .filter((lineMatch) => lineMatch.differences.length > 0);
    contractResults.push({
      source: summarizeContract(match.source),
      target: summarizeContract(match.target),
      match: match.reason,
      sourceEndpoint: sourceLineResult.endpoint,
      targetEndpoint: targetLineResult.endpoint,
      sourceFallback: sourceLineResult.fallback,
      targetFallback: targetLineResult.fallback,
      sourceLineCount: sourceLineResult.rows.length,
      targetLineCount: targetLineResult.rows.length,
      matchedLineCount: lineAudit.matches.length,
      matchedLineDifferences,
      missingLines: lineAudit.missing.map(summarizeLine),
      targetOnlyLines: lineAudit.targetOnly.map(summarizeLine),
      targetDuplicateLineGroups: duplicateGroups(
        targetLineResult.rows,
        lineExactKey,
      ).map((group) => ({
        key: group.key,
        rows: group.rows.map(summarizeLine),
      })),
    });
    if ((contractIndex + 1) % 10 === 0) await sleep(250);
  }

  // Billing File commitments are real project structure and must be audited
  // like every other PO. Their vendor may differ, but their header and lines
  // are not optional.
  const actionableMissingContracts = contractAudit.missing;
  const actionableTargetOnlyContracts = contractAudit.targetOnly;
  const missingContractLineResults = [];
  for (const contract of actionableMissingContracts) {
    const lineResult = await fetchLines(
      sourceCompanyId,
      sourceProjectId,
      text(contract.id),
    );
    sourceProjectLines.push(...lineResult.rows);
    missingContractLineResults.push({
      contract: summarizeContract(contract),
      endpoint: lineResult.endpoint,
      fallback: lineResult.fallback,
      lineCount: lineResult.rows.length,
      lines: lineResult.rows.map(summarizeLine),
    });
  }
  const targetOnlyContractLineResults = [];
  for (const contract of actionableTargetOnlyContracts) {
    const lineResult = await fetchLines(
      targetCompanyId,
      targetProjectId,
      text(contract.id),
    );
    targetProjectLines.push(...lineResult.rows);
    targetOnlyContractLineResults.push({
      contract: summarizeContract(contract),
      endpoint: lineResult.endpoint,
      fallback: lineResult.fallback,
      lineCount: lineResult.rows.length,
      lines: lineResult.rows.map(summarizeLine),
    });
  }
  const projectWideLineAudit = matchLines(
    sourceProjectLines,
    targetProjectLines,
  );

  const result = {
    index,
    total,
    sourceProjectId,
    targetProjectId,
    projectNumber: text(pair.target.project_number),
    projectName: text(pair.target.name),
    match: pair.match,
    sourceContractCount: sourceContracts.length,
    targetContractCount: targetContracts.length,
    matchedContractCount: contractAudit.matches.length,
    missingContracts: actionableMissingContracts.map(summarizeContract),
    ignoredSourceBillingFileContracts: [],
    targetOnlyContracts: actionableTargetOnlyContracts.map(summarizeContract),
    ignoredTargetBillingFileContracts: [],
    missingContractLineResults,
    targetOnlyContractLineResults,
    targetDuplicateContractNumbers: duplicateGroups(
      targetContracts,
      contractNumberKey,
    ).map((group) => ({
      number: group.key,
      rows: group.rows.map(summarizeContract),
    })),
    missingLineCount: contractResults.reduce(
      (sum, contract) => sum + contract.missingLines.length,
      0,
    ),
    matchedLineDifferenceCount: contractResults.reduce(
      (sum, contract) => sum + contract.matchedLineDifferences.length,
      0,
    ),
    targetOnlyLineCount: contractResults.reduce(
      (sum, contract) => sum + contract.targetOnlyLines.length,
      0,
    ),
    targetDuplicateLineGroupCount: contractResults.reduce(
      (sum, contract) => sum + contract.targetDuplicateLineGroups.length,
      0,
    ),
    endpointFallbackCount: contractResults.filter(
      (contract) => contract.sourceFallback || contract.targetFallback,
    ).length +
      missingContractLineResults.filter((contract) => contract.fallback).length +
      targetOnlyContractLineResults.filter((contract) => contract.fallback).length,
    sourceProjectLineCount: sourceProjectLines.length,
    targetProjectLineCount: targetProjectLines.length,
    projectWideMissingLineCount: projectWideLineAudit.missing.length,
    projectWideTargetOnlyLineCount: projectWideLineAudit.targetOnly.length,
    projectWideMissingLines: projectWideLineAudit.missing.map(summarizeLine),
    projectWideTargetOnlyLines:
      projectWideLineAudit.targetOnly.map(summarizeLine),
    contracts: contractResults,
  };

  console.log(
    JSON.stringify({
      event: "project_commitment_audit",
      index,
      total,
      targetProjectId,
      projectNumber: result.projectNumber,
      projectName: result.projectName,
      sourceContracts: result.sourceContractCount,
      targetContracts: result.targetContractCount,
      missingContracts: result.missingContracts.length,
      ignoredBillingFiles: result.ignoredSourceBillingFileContracts.length,
      targetOnlyContracts: result.targetOnlyContracts.length,
      missingLines: result.missingLineCount,
      changedMatchedLines: result.matchedLineDifferenceCount,
      projectWideMissingLines: result.projectWideMissingLineCount,
      projectWideTargetOnlyLines: result.projectWideTargetOnlyLineCount,
      targetOnlyLines: result.targetOnlyLineCount,
      duplicateContractNumbers: result.targetDuplicateContractNumbers.length,
      duplicateLineGroups: result.targetDuplicateLineGroupCount,
      endpointFallbacks: result.endpointFallbackCount,
    }),
  );
  return result;
}

const startedAt = new Date().toISOString();
const sourceProjects = await fetchProjects(sourceCompanyId);
const targetProjects = await fetchProjects(targetCompanyId);
const { pairs, unmatched } = pairProjects(sourceProjects, targetProjects);
const projectResults = [];

for (const [index, pair] of pairs.entries()) {
  projectResults.push(await auditProject(pair, index + 1, pairs.length));
  await sleep(250);
}

const report = {
  event: "commitment_audit_complete",
  generatedAt: new Date().toISOString(),
  startedAt,
  sourceCompanyId,
  targetCompanyId,
  sourceProjects: sourceProjects.length,
  targetProjects: targetProjects.length,
  pairedProjects: pairs.length,
  unmatchedTargetProjects: unmatched,
  requestCount,
  rateLimitWaits,
  projectsWithMissingContracts: projectResults.filter(
    (project) => project.missingContracts.length > 0,
  ).length,
  missingContractCount: projectResults.reduce(
    (sum, project) => sum + project.missingContracts.length,
    0,
  ),
  projectsWithMissingLines: projectResults.filter(
    (project) => project.missingLineCount > 0,
  ).length,
  missingLineCount: projectResults.reduce(
    (sum, project) => sum + project.missingLineCount,
    0,
  ),
  projectsWithMatchedLineDifferences: projectResults.filter(
    (project) => project.matchedLineDifferenceCount > 0,
  ).length,
  matchedLineDifferenceCount: projectResults.reduce(
    (sum, project) => sum + project.matchedLineDifferenceCount,
    0,
  ),
  projectsWithProjectWideMissingLines: projectResults.filter(
    (project) => project.projectWideMissingLineCount > 0,
  ).length,
  projectWideMissingLineCount: projectResults.reduce(
    (sum, project) => sum + project.projectWideMissingLineCount,
    0,
  ),
  projectWideTargetOnlyLineCount: projectResults.reduce(
    (sum, project) => sum + project.projectWideTargetOnlyLineCount,
    0,
  ),
  ignoredSourceBillingFileContractCount: projectResults.reduce(
    (sum, project) =>
      sum + project.ignoredSourceBillingFileContracts.length,
    0,
  ),
  projectsWithTargetOnlyContracts: projectResults.filter(
    (project) => project.targetOnlyContracts.length > 0,
  ).length,
  targetOnlyContractCount: projectResults.reduce(
    (sum, project) => sum + project.targetOnlyContracts.length,
    0,
  ),
  targetOnlyLineCount: projectResults.reduce(
    (sum, project) => sum + project.targetOnlyLineCount,
    0,
  ),
  duplicateContractNumberGroups: projectResults.reduce(
    (sum, project) => sum + project.targetDuplicateContractNumbers.length,
    0,
  ),
  duplicateLineGroups: projectResults.reduce(
    (sum, project) => sum + project.targetDuplicateLineGroupCount,
    0,
  ),
  endpointFallbacks: projectResults.reduce(
    (sum, project) => sum + project.endpointFallbackCount,
    0,
  ),
  projects: projectResults,
};

mkdirSync(resolve(process.cwd(), "logs"), { recursive: true });
const reportPath = resolve(
  process.cwd(),
  "logs",
  `commitment-audit-${report.generatedAt.replace(/[:.]/g, "-")}.json`,
);
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(
  JSON.stringify({
    event: report.event,
    generatedAt: report.generatedAt,
    pairedProjects: report.pairedProjects,
    unmatchedTargetProjects: report.unmatchedTargetProjects.length,
    requestCount: report.requestCount,
    rateLimitWaits: report.rateLimitWaits,
    projectsWithMissingContracts: report.projectsWithMissingContracts,
    missingContractCount: report.missingContractCount,
    projectsWithMissingLines: report.projectsWithMissingLines,
    missingLineCount: report.missingLineCount,
    projectsWithMatchedLineDifferences:
      report.projectsWithMatchedLineDifferences,
    matchedLineDifferenceCount: report.matchedLineDifferenceCount,
    projectsWithProjectWideMissingLines:
      report.projectsWithProjectWideMissingLines,
    projectWideMissingLineCount: report.projectWideMissingLineCount,
    projectWideTargetOnlyLineCount: report.projectWideTargetOnlyLineCount,
    ignoredSourceBillingFileContractCount:
      report.ignoredSourceBillingFileContractCount,
    projectsWithTargetOnlyContracts: report.projectsWithTargetOnlyContracts,
    targetOnlyContractCount: report.targetOnlyContractCount,
    targetOnlyLineCount: report.targetOnlyLineCount,
    duplicateContractNumberGroups: report.duplicateContractNumberGroups,
    duplicateLineGroups: report.duplicateLineGroups,
    endpointFallbacks: report.endpointFallbacks,
    reportPath,
  }),
);
