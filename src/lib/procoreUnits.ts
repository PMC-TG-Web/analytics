const COST_ITEM_UNIT_MAP: Record<string, string> = {
  ea: "Ea",
  each: "Ea",
  ft: "Ft",
  lf: "Ft",
  feet: "Ft",
  sf: "SqFt",
  "sq ft": "SqFt",
  sqft: "SqFt",
  sy: "SqYd",
  "sq yd": "SqYd",
  sqyd: "SqYd",
  cf: "CuFt",
  "cu ft": "CuFt",
  cuft: "CuFt",
  cy: "CuYd",
  "cu yd": "CuYd",
  "c u yd": "CuYd",
  "cubic yard": "CuYd",
  "cubic yards": "CuYd",
  yd3: "CuYd",
  gal: "Gal",
  gallon: "Gal",
  gallons: "Gal",
  lb: "Lb",
  lbs: "Lb",
  pound: "Lb",
  pounds: "Lb",
  yd: "Yd",
  yard: "Yd",
  yards: "Yd",
  min: "Minutes",
  mins: "Minutes",
  minute: "Minutes",
  minutes: "Minutes",
  hr: "Hours",
  hrs: "Hours",
  hour: "Hours",
  hours: "Hours",
  day: "Days",
  days: "Days",
  week: "Weeks",
  weeks: "Weeks",
  month: "Months",
  months: "Months",
  square: "Square",
  none: "None",
  ton: "Ton",
  tons: "Ton",
  ls: "LumpSum",
  lot: "LumpSum",
  lots: "LumpSum",
  lumpsum: "LumpSum",
  "lump sum": "LumpSum",
};

const LABOR_TIME_UNIT_MAP: Record<string, string> = {
  min: "Minutes",
  mins: "Minutes",
  minute: "Minutes",
  minutes: "Minutes",
  hr: "Hours",
  hrs: "Hours",
  hour: "Hours",
  hours: "Hours",
  day: "Days",
  days: "Days",
  week: "Weeks",
  weeks: "Weeks",
  month: "Months",
  months: "Months",
};

const LABOR_TIME_UNIT_VALUES = new Set(Object.values(LABOR_TIME_UNIT_MAP));

function normalizeKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeProcoreCostItemUnit(raw: string): string {
  const key = normalizeKey(raw);
  return COST_ITEM_UNIT_MAP[key] || raw.trim();
}

export function normalizeProcoreLaborTimeUnit(raw: string): string {
  const key = normalizeKey(raw);
  const mapped = LABOR_TIME_UNIT_MAP[key];
  if (mapped) return mapped;

  const trimmed = raw.trim();
  return LABOR_TIME_UNIT_VALUES.has(trimmed) ? trimmed : "";
}