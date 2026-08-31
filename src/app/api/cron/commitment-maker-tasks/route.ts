import { NextRequest, NextResponse } from "next/server";

import { hasValidProcoreSyncSecret, withProcoreLiveApiBypassForSyncSecret } from "@/lib/procore";
import {
  enqueueCommitmentMakerTasks,
  processNextCommitmentMakerTaskJob,
} from "@/lib/procoreCommitmentMakerTaskQueue";

export const dynamic = "force-dynamic";
export const maxDuration = 780;

export async function POST(request: NextRequest) {
  if (!hasValidProcoreSyncSecret(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  return withProcoreLiveApiBypassForSyncSecret(request, async () => {
    const body = await request.json().catch(() => ({}));
    if (body?.enqueue) {
      const changeOrder = body.changeOrder || {};
      await enqueueCommitmentMakerTasks({
        companyId: String(body.companyId || "").trim(),
        projectId: String(body.projectId || "").trim(),
        changeOrder: {
          packageId: String(changeOrder.packageId || "").trim(),
          number: String(changeOrder.number || "").trim(),
          title: String(changeOrder.title || "").trim(),
          amount: changeOrder.amount === null ? null : Number(changeOrder.amount),
        },
        userEmail: String(body.userEmail || "procore-project-link@pmcdecor.com").trim(),
        commitmentChangeOrderId: String(body.commitmentChangeOrderId || "").trim() || undefined,
      });
    }
    const result = await processNextCommitmentMakerTaskJob();
    return NextResponse.json(result, { status: result.success ? 200 : 500 });
  });
}
