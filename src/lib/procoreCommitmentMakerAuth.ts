import { getClientCredentialsToken } from '@/lib/procore';
import { currentProcoreConnection } from '@/lib/procoreConnection';

export async function getCommitmentMakerProcoreToken(cookieToken: string) {
  try {
    return { accessToken: await getClientCredentialsToken(), tokenSource: 'client_credentials' };
  } catch (error) {
    // Browser OAuth belongs to the original app. Never account that token's
    // requests against a dedicated app or use it to escape that app's limits.
    if (currentProcoreConnection() !== 'shared' || !cookieToken) throw error;
    return { accessToken: cookieToken, tokenSource: 'user_oauth_fallback' };
  }
}
