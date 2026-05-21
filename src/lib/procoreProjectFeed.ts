export const CUSTOMER_CUSTOM_FIELD_ID = process.env.PROCORE_CUSTOMER_FIELD_ID || '598134325737314';
export const DEFAULT_INTERNAL_VENDOR_NAMES = [
  'paradise masonry, llc',
  'paradise concrete solutions',
  'mcdonnel consulting',
  'pmc procore direct costs',
];

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' ? (value as JsonObject) : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function isMeaningfulCustomer(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && !['unknown', 'n/a', 'na', 'none'].includes(trimmed.toLowerCase());
}

export function getInternalVendorSet(): Set<string> {
  const configured = (process.env.PROCORE_INTERNAL_VENDOR_NAMES || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);

  return new Set([...DEFAULT_INTERNAL_VENDOR_NAMES, ...configured]);
}

export function isInternalCustomerName(value: unknown, internalVendorSet = getInternalVendorSet()): boolean {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 && internalVendorSet.has(normalized);
}

export function extractCustomerFromCustomFields(customFields: unknown): string | null {
  if (!customFields || typeof customFields !== 'object') return null;
  const entries: JsonObject[] = Array.isArray(customFields)
    ? customFields
        .map(asObject)
        .filter((value): value is JsonObject => Boolean(value))
    : Object.values(customFields as JsonObject)
        .map(asObject)
        .filter((value): value is JsonObject => Boolean(value));

  for (const field of entries) {
    const id = readString(field.id);
    const label = readString(field.label);
    const value = asObject(field.value);
    const valueLabel = readString(value?.label);
    const keyId = Object.entries(customFields as JsonObject).find(([, entry]) => entry === field)?.[0]?.match(/custom_field_(\d+)/)?.[1] || null;

    if ((String(id || '') === CUSTOMER_CUSTOM_FIELD_ID || keyId === CUSTOMER_CUSTOM_FIELD_ID) && isMeaningfulCustomer(valueLabel)) {
      return valueLabel.trim();
    }

    if (String(id || '') === CUSTOMER_CUSTOM_FIELD_ID && isMeaningfulCustomer(label)) {
      return label.trim();
    }
  }

  for (const field of entries) {
    const value = readString(field.value);
    const label = readString(field.label);
    const name = readString(field.name);
    const labelValue = readString(field.label_value);
    const valueObject = asObject(field.value);
    const nestedValueLabel = readString(valueObject?.label);

    if (isMeaningfulCustomer(nestedValueLabel)) {
      return nestedValueLabel.trim();
    }

    if (isMeaningfulCustomer(value) && [label, name].some((v) => String(v || '').toLowerCase() === 'customer')) {
      return value.trim();
    }

    if (isMeaningfulCustomer(labelValue)) {
      return labelValue.trim();
    }

    if (isMeaningfulCustomer(label) && String(label).toLowerCase() !== 'customer') {
      return label.trim();
    }
  }

  return null;
}

