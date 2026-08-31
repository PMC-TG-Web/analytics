import { prisma } from "@/lib/prisma";
import { getClientCredentialsToken, makeRequest } from "@/lib/procore";
import {
  ensureCommitmentMakerChangeOrderTasks,
  type CommitmentMakerChangeOrderContext,
  type CommitmentMakerTaskRequest,
} from "@/lib/procoreCommitmentMakerTasks";

type UnknownRecord = Record<string, unknown>;

async function findShellyCompanyUser(): Promise<UnknownRecord | null> {
  const rows = await prisma.$queryRawUnsafe<Array<{ payload: UnknownRecord }>>(
    `
      SELECT payload
      FROM procore_company_users_live
      WHERE LOWER(COALESCE(login, payload->>'login', payload->>'email', payload->>'email_address', '')) = 'shelly@pmcdecor.com'
      LIMIT 1
    `,
  );
  return rows[0]?.payload || null;
}

function taskRequest(accessToken: string, companyId: string): CommitmentMakerTaskRequest {
  return ({ path, method, body }) => makeRequest(path, accessToken, {
    method: method || "GET",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, companyId);
}

export async function runCommitmentMakerChangeOrderTasks(params: {
  companyId: string;
  projectId: string;
  changeOrder: CommitmentMakerChangeOrderContext;
  userEmail: string;
}) {
  const [accessToken, project, shellyCompanyUser] = await Promise.all([
    getClientCredentialsToken(),
    prisma.pmcProject.findUnique({
      where: {
        companyId_procoreProjectId: {
          companyId: params.companyId,
          procoreProjectId: params.projectId,
        },
      },
      select: { projectNumber: true, projectName: true },
    }),
    findShellyCompanyUser(),
  ]);
  const result = await ensureCommitmentMakerChangeOrderTasks({
    companyId: params.companyId,
    projectId: params.projectId,
    projectNumber: project?.projectNumber || null,
    projectName: project?.projectName || `Procore Project ${params.projectId}`,
    changeOrder: params.changeOrder,
    shellyCompanyUser,
    request: taskRequest(accessToken, params.companyId),
  });
  await prisma.auditLog.create({
    data: {
      action: "change-order-tasks",
      entity: "ProcoreCommitmentMaker",
      entityId: params.changeOrder.packageId,
      userEmail: params.userEmail,
      changes: JSON.parse(JSON.stringify({ projectId: params.projectId, changeOrder: params.changeOrder, taskResult: result })),
    },
  });
  return result;
}
