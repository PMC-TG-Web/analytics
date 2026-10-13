export const fieldClass = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900';
export const hours = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 2 });
export function downloadCsv(contents: string, filename: string) {
  const url = URL.createObjectURL(new Blob(['\uFEFF', contents], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a'); link.href = url; link.download = filename;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
