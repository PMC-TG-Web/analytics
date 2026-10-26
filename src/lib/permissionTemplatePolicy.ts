import { JOB_TITLE_TEMPLATE_CATEGORY, JOB_TITLE_TEMPLATE_PREFIX } from './permissions';

// Both identifiers are reserved: a generic constants edit must not bypass the
// administrator boundary by omitting or renaming one of them.
export function isPermissionTemplateRecord(record: { name?: unknown; category?: unknown } | null | undefined) {
  return !!record && ((typeof record.name === 'string' && record.name.startsWith(JOB_TITLE_TEMPLATE_PREFIX))
    || record.category === JOB_TITLE_TEMPLATE_CATEGORY);
}
