import { createHash } from 'node:crypto';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const RECORD_TYPES = new Set(['project', 'customer-only', 'unassigned']);
const ACCOUNTING_METHODS = new Set(['Accrual', 'Cash']);
const DIRECT_COST_STATUSES = new Set(['available', 'unavailable', 'not-matched']);
const MONEY_FIELDS = [
  'sales',
  'costOfGoodsSold',
  'operatingExpenses',
  'otherIncome',
  'otherExpenses',
  'actualCost',
  'profit',
  'reportedNetIncome',
  'reconciliationDifference',
];

function requiredString(value, label, maxLength = 1000) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new Error(`${label} is required.`);
  if (normalized.length > maxLength) throw new Error(`${label} exceeds ${maxLength} characters.`);
  return normalized;
}

function optionalString(value, label, maxLength = 1000) {
  if (value == null || value === '') return null;
  return requiredString(value, label, maxLength);
}

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > 1_000_000_000_000) {
    throw new Error(`${label} must be a finite number within the supported range.`);
  }
  return number;
}

function optionalFiniteNumber(value, label) {
  if (value == null || value === '') return null;
  return finiteNumber(value, label);
}

function validDate(value, label) {
  const normalized = requiredString(value, label, 10);
  if (!DATE_PATTERN.test(normalized)) throw new Error(`${label} must use YYYY-MM-DD format.`);
  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) {
    throw new Error(`${label} is invalid.`);
  }
  return date;
}

function validateJsonObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

export function hashQboProfitabilitySource(raw) {
  return createHash('sha256').update(raw).digest('hex');
}

export function normalizeQboProfitabilityPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('The profitability payload must be an object.');
  }
  if (payload.readOnly !== true) {
    throw new Error('Only read-only profitability exports may be imported.');
  }

  const generatedAt = new Date(requiredString(payload.generatedAt, 'generatedAt', 64));
  if (Number.isNaN(generatedAt.getTime())) throw new Error('generatedAt is invalid.');
  const startDate = validDate(payload.startDate, 'startDate');
  const endDate = validDate(payload.endDate, 'endDate');
  if (startDate > endDate) throw new Error('startDate must be on or before endDate.');

  const accountingMethod = requiredString(payload.accountingMethod, 'accountingMethod', 16);
  if (!ACCOUNTING_METHODS.has(accountingMethod)) {
    throw new Error('accountingMethod must be Accrual or Cash.');
  }
  const summary = validateJsonObject(payload.summary, 'summary');
  const sourceCounts = validateJsonObject(payload.sourceCounts, 'sourceCounts');
  if (!Array.isArray(payload.rows) || payload.rows.length > 50_000) {
    throw new Error('rows must be an array containing no more than 50,000 records.');
  }

  const seenCustomerIds = new Set();
  const rows = payload.rows.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error(`rows[${index}] must be an object.`);
    }
    const qboCustomerId = requiredString(row.qboCustomerId, `rows[${index}].qboCustomerId`, 128);
    if (seenCustomerIds.has(qboCustomerId)) {
      throw new Error(`Duplicate qboCustomerId ${qboCustomerId}.`);
    }
    seenCustomerIds.add(qboCustomerId);
    const recordType = requiredString(row.recordType, `rows[${index}].recordType`, 32);
    if (!RECORD_TYPES.has(recordType)) {
      throw new Error(`rows[${index}].recordType is unsupported.`);
    }

    const normalized = {
      qboCustomerId,
      recordType,
      projectName: requiredString(row.projectName, `rows[${index}].projectName`, 500),
      fullyQualifiedName: requiredString(row.fullyQualifiedName, `rows[${index}].fullyQualifiedName`, 1000),
      active: row.active !== false,
      parentCustomerId: optionalString(row.parentCustomerId, `rows[${index}].parentCustomerId`, 128),
      procoreProjectId: optionalString(row.procoreProjectId, `rows[${index}].procoreProjectId`, 128),
      procoreProjectNumber: optionalString(row.procoreProjectNumber, `rows[${index}].procoreProjectNumber`, 128),
      procoreProjectName: optionalString(row.procoreProjectName, `rows[${index}].procoreProjectName`, 500),
      procoreMatchMethod: requiredString(row.procoreMatchMethod, `rows[${index}].procoreMatchMethod`, 64),
      procoreDirectCost: optionalFiniteNumber(row.procoreDirectCost, `rows[${index}].procoreDirectCost`),
      procoreDirectCostLineCount: finiteNumber(
        row.procoreDirectCostLineCount ?? 0,
        `rows[${index}].procoreDirectCostLineCount`,
      ),
      procoreDirectCostStatus: optionalString(
        row.procoreDirectCostStatus,
        `rows[${index}].procoreDirectCostStatus`,
        32,
      ),
      qboMinusProcoreDirectCost: optionalFiniteNumber(
        row.qboMinusProcoreDirectCost,
        `rows[${index}].qboMinusProcoreDirectCost`,
      ),
      marginPercent: row.marginPercent == null
        ? null
        : finiteNumber(row.marginPercent, `rows[${index}].marginPercent`),
    };
    for (const field of MONEY_FIELDS) {
      normalized[field] = finiteNumber(row[field], `rows[${index}].${field}`);
    }
    if (!Number.isInteger(normalized.procoreDirectCostLineCount) || normalized.procoreDirectCostLineCount < 0) {
      throw new Error(`rows[${index}].procoreDirectCostLineCount must be a non-negative integer.`);
    }
    if (normalized.procoreDirectCostStatus && !DIRECT_COST_STATUSES.has(normalized.procoreDirectCostStatus)) {
      throw new Error(`rows[${index}].procoreDirectCostStatus is unsupported.`);
    }
    return normalized;
  });

  return {
    generatedAt,
    startDate,
    endDate,
    accountingMethod,
    readOnly: true,
    summary,
    sourceCounts,
    rows,
  };
}
