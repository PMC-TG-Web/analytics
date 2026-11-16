export const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 });
export const month = (value: string | null) => value
  ? new Date(`${value}-01T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
  : 'No start month';
export const unitLabel = (unit: string) => unit === 'EA' ? 'pieces' : unit;
