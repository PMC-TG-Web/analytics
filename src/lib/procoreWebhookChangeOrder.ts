type JsonObject = Record<string, unknown>;

function rows(payload: unknown): JsonObject[] {
  const object = payload && typeof payload === 'object' ? payload as JsonObject : {};
  const candidates = [payload, object.data, object.items, object.results, object.potential_change_orders];
  const list = candidates.find(Array.isArray) as unknown[] | undefined;
  return (list || []).filter((value): value is JsonObject => Boolean(value) && typeof value === 'object' && !Array.isArray(value));
}

// An update can arrive after its source was deleted. Only an exact ID with a
// deletion timestamp from Procore's deleted collection proves it is obsolete.
// An empty list, a permission error, or a different ID must remain retryable.
export async function resolveWebhookPotentialChangeOrder(
  projectId: string,
  resourceId: string,
  read: (path: string) => Promise<unknown>,
): Promise<JsonObject | null> {
  const query = new URLSearchParams({
    project_id: projectId,
    'filters[id][]': resourceId,
    page: '1',
    per_page: '100',
  });
  const path = () => `/rest/v1.0/potential_change_orders?${query}`;
  const current = rows(await read(path())).find(row => String(row.id) === resourceId);
  if (current && !current.deleted_at) return current;

  query.set('filters[include_deleted]', 'only');
  const deleted = rows(await read(path())).find(row => String(row.id) === resourceId);
  if (deleted && typeof deleted.deleted_at === 'string' && Number.isFinite(Date.parse(deleted.deleted_at))) {
    return null;
  }
  throw new Error(`Potential Change Order ${resourceId} returned no record.`);
}
