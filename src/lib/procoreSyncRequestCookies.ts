type CookieStore = {
  get(name: string): { value?: string } | undefined;
};

export type ProcoreSyncCookieValues = {
  accessToken: string;
  companyId: string;
};

export async function readProcoreSyncCookieValues(
  hasSyncSecret: boolean,
  loadCookies: () => Promise<CookieStore>,
): Promise<ProcoreSyncCookieValues> {
  if (hasSyncSecret) {
    return { accessToken: '', companyId: '' };
  }

  const cookieStore = await loadCookies();
  return {
    accessToken: cookieStore.get('procore_access_token')?.value || '',
    companyId: cookieStore.get('procore_company_id')?.value || '',
  };
}
