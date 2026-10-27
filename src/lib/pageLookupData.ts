import type { PrismaClient } from '@prisma/client';

export function loadCrewEmployees(db: Pick<PrismaClient, 'employee'>) {
  return db.employee.findMany({
    where: { isActive: true },
    select: { id: true, firstName: true, lastName: true, jobTitle: true, isActive: true },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
  });
}

export function loadCertificationEmployees(db: Pick<PrismaClient, 'employee'>) {
  return db.employee.findMany({
    where: { isActive: true },
    select: { id: true, firstName: true, lastName: true },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
  });
}

export function loadEstimatingProjects(db: Pick<PrismaClient, 'project'>) {
  // Estimating's existing saved selections use local Project.id. Preserve that
  // contract; an external Procore/bid-board ID is not a replacement for it.
  // Narrow fields make the full option list affordable without the old 100-row
  // truncation. Never collapse distinct records by project name or number.
  return db.project.findMany({
    where: { AND: [
      { OR: [{ projectArchived: false }, { projectArchived: null }] },
      { OR: [{ status: null }, { status: { notIn: ['Lost', 'Archived'] } }] },
    ] },
    select: { id: true, projectName: true, projectNumber: true, customer: true },
    orderBy: [{ projectName: 'asc' }, { id: 'asc' }],
  });
}

export async function loadCertificationReview(db: Pick<PrismaClient, 'certification'>) {
  const records = await db.certification.findMany({
    select: {
      id: true, employeeId: true, type: true, issueDate: true, expirationDate: true, notes: true,
      employee: { select: { firstName: true, lastName: true } },
    },
    orderBy: [{ expirationDate: 'asc' }, { id: 'asc' }],
  });
  return records.map(({ employee, ...record }) => ({
    ...record, employeeName: `${employee.firstName} ${employee.lastName}`.trim(),
  }));
}
