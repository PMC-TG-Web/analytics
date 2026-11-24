import { readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import XLSX from 'xlsx';
import { cents } from '../../src/lib/jobCloseout.mjs';

function contained(root, target) {
  const relative = path.relative(root, target);
  return relative && !path.isAbsolute(relative) && relative.split(path.sep)[0] !== '..';
}

function displayedAmount(cell) {
  if (cell?.t !== 'n') throw Error('Payment amount needs a saved numeric value.');
  const shown = String(cell.w ?? cell.v)
    .trim()
    .replace(/[$,\s]/g, '')
    .replace(/^\((.+)\)$/, '-$1');
  if (/^-+$/.test(shown) && cell.v === 0) return 0;
  return cents(shown);
}

export function readApplication(book, file) {
  const name = book.SheetNames.find((n) => n.trim().toLowerCase() === 'application for payment');
  if (!name) throw Error('Application for Payment sheet missing.');
  const sheet = book.Sheets[name];
  const entries = Object.entries(sheet).filter(([key]) => /^[A-Z]+\d+$/.test(key));
  const labels = entries.filter(
    ([, cell]) => typeof cell.v === 'string' && /\bcurrent payment due\b/i.test(cell.v),
  );
  if (labels.length !== 1) throw Error('Current Payment Due label is missing or ambiguous.');
  const pos = XLSX.utils.decode_cell(labels[0][0]);
  const candidates = entries.filter(([key, cell]) => {
    const p = XLSX.utils.decode_cell(key);
    return p.r === pos.r && p.c > pos.c && cell.t === 'n';
  });
  if (candidates.length !== 1) throw Error('Current Payment Due amount is missing or ambiguous.');
  const number = String(sheet.V2?.v ?? '').trim();
  if (!number) throw Error('Application number is missing.');
  const period = sheet.V3?.v;
  let date = null;
  if (period != null && period !== '' && period !== 0) {
    const d =
      typeof period === 'number' && Number.isFinite(period)
        ? XLSX.SSF.parse_date_code(period, { date1904: !!book.Workbook?.WBProps?.date1904 })
        : null;
    if (!d?.y || !d.d) throw Error('The Period To cell (V3) needs a valid Excel date.');
    date = [d.y, String(d.m).padStart(2, '0'), String(d.d).padStart(2, '0')].join('-');
  }
  const schedule = [];
  const continuation = book.Sheets[book.SheetNames.find((n) => n.trim().toLowerCase() === 'continuation sheet')];
  if (continuation) {
    for (const [key, cell] of Object.entries(continuation)) {
      if (!/^B\d+$/.test(key) || typeof cell.v !== 'string') continue;
      const amount = continuation['C' + key.slice(1)];
      if (amount?.t === 'n' && !/\btotal\b/i.test(cell.v))
        schedule.push({ description: cell.v, amount: displayedAmount(amount) });
    }
  }
  return {
    number,
    date,
    file,
    cell: name + '!' + candidates[0][0],
    amount: displayedAmount(candidates[0][1]),
    schedule,
  };
}

// Resolve only a unique contractor and exact job folder. The office can pin other naming conventions.
export async function locateAiaFolder(root, contractor, projectName, number) {
  const normalize = (s) =>
    String(s ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  const customers = (s) => normalize(String(s ?? '').replace(/\b(group|incorporated|inc|llc|corp)\b\.?/gi, ''));
  if (!customers(contractor)) return null;
  const directories = async (dir) =>
    (await readdir(dir, { withFileTypes: true }))
      .filter((f) => f.isDirectory() && !f.isSymbolicLink())
      .map((f) => f.name);
  const parents = (await directories(root)).filter((n) => customers(n) === customers(contractor));
  if (parents.length !== 1) return null;
  const found = [],
    parent = parents[0],
    entries = await directories(path.join(root, parent));
  const match = (n) => [projectName, number].some((s) => normalize(s) && normalize(s) === normalize(n));
  for (const n of entries) {
    if (match(n)) found.push(path.join(parent, n));
    else if (/^(complete[d]?|active|in progress)$/i.test(n)) {
      for (const job of await directories(path.join(root, parent, n)))
        if (match(job)) found.push(path.join(parent, n, job));
    }
  }
  return found.length === 1 ? found[0] : null;
}

export async function readAia(root, folder) {
  const apps = [],
    issues = [];
  if (!folder)
    return { apps, issues: ['Select the project folder under AIA Documents.'], complete: false, schedule: [] };
  if (path.isAbsolute(folder) || folder.split(/[\\/]/).includes('..'))
    throw Error('Use a relative project folder under AIA Documents.');
  const base = await realpath(root),
    dir = await realpath(path.resolve(base, folder));
  if (!contained(base, dir)) throw Error('Folder is outside AIA Documents.');
  for (const f of await readdir(dir, { withFileTypes: true })) {
    if (f.name.startsWith('~$') || !/\.(xls|xlsx|xlsm)$/i.test(f.name)) continue;
    try {
      const location = await realpath(path.join(dir, f.name));
      if (!contained(dir, location)) throw Error('Workbook resolves outside the project folder.');
      apps.push(readApplication(XLSX.read(await readFile(location), { type: 'buffer' }), f.name));
    } catch (err) {
      issues.push(f.name + ' · ' + err.message);
    }
  }
  if (!apps.length) issues.push('No readable AIA applications found.');
  if (new Set(apps.map((a) => a.number)).size !== apps.length)
    issues.push('Duplicate application numbers. Verify revisions in the folder.');
  if (apps.length && apps.every((a) => /^\d+$/.test(a.number))) {
    const sequence = [...new Set(apps.map((a) => Number(a.number)))].sort((a, b) => a - b);
    if (sequence.some((number, index) => number !== index + 1))
      issues.push('Application numbers have a gap. Check for missing files or a different numbering sequence.');
  }
  if (apps.every((a) => /^\d+$/.test(a.number))) apps.sort((a, b) => Number(a.number) - Number(b.number));
  else
    apps.sort(
      (a, b) =>
        (a.date ?? '').localeCompare(b.date ?? '') ||
        a.number.localeCompare(b.number, undefined, { numeric: true }),
    );
  return { apps, issues, complete: !issues.length, schedule: apps.at(-1)?.schedule ?? [] };
}
