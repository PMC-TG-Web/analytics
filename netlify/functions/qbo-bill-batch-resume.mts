import type { Config } from '@netlify/functions';
import { dispatchBillBatch } from '../../src/lib/qboBillBatchDispatch';
// This resumes already authorized runs. It never creates a new run/nightly bill.
export default async function handler() {
  if (process.env.QBO_BILL_BATCH_ENABLED !== 'true') return Response.json({ enabled: false });
  const dispatched = await dispatchBillBatch();
  console.log(JSON.stringify({ event: 'qbo-bill-batch-resume', dispatched }));
  return Response.json({ dispatched }, { status: dispatched ? 200 : 503 });
}
export const config: Config = { schedule: '*/5 * * * *' };
