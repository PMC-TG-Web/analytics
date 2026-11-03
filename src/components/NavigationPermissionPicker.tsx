'use client';

import { useState } from 'react';
import { filterPageAccessCatalog, includedPageParents, PAGE_ACCESS_CATALOG } from '@/lib/pageAccessCatalog';
import { expandAssignedPermissions } from '@/lib/permissions';
import { updateIndependentPagePermission } from '@/lib/independentPagePermissions';

export default function NavigationPermissionPicker({ value, onChange }: {
  value: string[];
  onChange: (permissions: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const visible = filterPageAccessCatalog(query);
  const effective = expandAssignedPermissions(value);
  return <div className="space-y-2">
    <input type="search" aria-label="Search navigation permissions" placeholder="Search pages…"
      value={query} onChange={event => setQuery(event.target.value)}
      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
    <p className="text-xs text-gray-600">Main pages automatically include their Help guides and supporting views. Separate main pages have their own checkboxes. New pages appear automatically.</p>
    <div className="max-h-80 space-y-4 overflow-y-auto rounded-lg border border-gray-300 bg-gray-50 p-3">
      {(['Pages', 'Help guides', 'System and redirected pages', 'Other access'] as const).map(section => {
        const entries = visible.filter(entry => entry.section === section);
        if (!entries.length) return null;
        return <fieldset key={section}>
          <legend className="mb-2 text-xs font-semibold text-gray-600">{section}</legend>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {entries.map(entry => {
              const includedWith = includedPageParents(entry, effective);
              return <label key={entry.id} className="flex items-start gap-2 text-sm text-gray-700">
                <input type="checkbox" aria-label={entry.label} disabled={!entry.permission || includedWith.length > 0}
                  checked={entry.permission ? effective.includes(entry.permission) : false}
                  onChange={event => {
                    if (!entry.permission || !entry.path) return;
                    onChange(updateIndependentPagePermission(value, entry.path, event.target.checked));
                  }} className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-teal-600" />
                <span className="min-w-0"><span className="block text-xs font-medium">{entry.label}</span>
                  {entry.path && <span className="block break-all text-[11px] text-gray-500">{entry.path}</span>}
                  {entry.note && <span className="mt-0.5 block text-[11px] text-gray-500">{entry.note}</span>}
                  {includedWith.length > 0 && <span className="mt-0.5 block text-[11px] font-medium text-teal-700">Included with {includedWith.join(', ')}.</span>}
                </span>
              </label>;
            })}
          </div>
        </fieldset>;
      })}
      {!visible.length && <p className="text-sm text-gray-600">No matching pages.</p>}
    </div>
    <p className="text-xs text-gray-500">{visible.length} of {PAGE_ACCESS_CATALOG.length} entries</p>
  </div>;
}
