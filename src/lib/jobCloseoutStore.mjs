// Review completion count isolates undo/re-complete cycles. Each refresh keeps the earlier report and decision.
const recent = { orderBy: [{ cycle: 'desc' }, { revision: 'desc' }], take: 1 };
const statusProjection = {
  id: true,
  state: true,
  folder: true,
  cycle: true,
  revision: true,
  generatedAt: true,
  requestedAt: true,
  decidedAt: true,
  decidedBy: true,
  note: true,
  error: true,
};

export async function closeoutQueue(db, companyId, projectId = null) {
  const reviews = await db.productivityProjectReview.findMany({
    where: { companyId, status: 'completed', ...(projectId ? { projectId } : {}) },
    select: {
      projectName: true,
      projectNumber: true,
      projectId: true,
      reviewedAt: true,
      completionCount: true,
      closeouts: { ...recent, select: { ...statusProjection, ...(projectId ? { report: true } : {}) } },
    },
    orderBy: { reviewedAt: 'desc' },
  });
  return reviews.map(({ closeouts, completionCount, ...review }) => ({
    ...review,
    cycle: completionCount,
    run: closeouts[0]?.cycle === completionCount ? closeouts[0] : null,
  }));
}

export async function discoverCloseouts(db, companyId) {
  const reviews = await db.productivityProjectReview.findMany({
    where: { companyId, status: 'completed' },
    select: { id: true, completionCount: true, closeouts: { ...recent, select: { cycle: true, folder: true } } },
  });
  const data = reviews
    .filter((r) => r.closeouts[0]?.cycle !== r.completionCount)
    .map((r) => ({ reviewId: r.id, cycle: r.completionCount, revision: 1, folder: r.closeouts[0]?.folder }));
  if (data.length) await db.jobCloseoutRun.createMany({ data, skipDuplicates: true });
}

export async function changeCloseout(db, companyId, actor, input) {
  const { projectId, cycle, runId, action } = input;
  const folder = input.folder?.trim() || null,
    note = input.note?.trim() || null;
  if (
    !['refresh', 'approve', 'close'].includes(action) ||
    !/^\d+$/.test(projectId) ||
    !Number.isInteger(cycle) ||
    (folder &&
      (folder.length > 420 ||
        /[:\x00-\x1f]/.test(folder) ||
        /^[\\/]/.test(folder) ||
        folder.split(/[\\/]/).some((s) => s === '..'))) ||
    (note && note.length > 2000)
  )
    return false;
  return db.$transaction(async (tx) => {
    const [review] =
      await tx.$queryRaw`SELECT id, completion_count FROM productivity_project_reviews WHERE company_id=${companyId} AND project_id=${projectId} AND status='completed' FOR UPDATE`;
    if (!review || review.completion_count !== cycle) return false;
    const current = await tx.jobCloseoutRun.findFirst({
      where: { reviewId: review.id, cycle },
      orderBy: { revision: 'desc' },
    });
    if ((current?.id ?? null) !== (runId ?? null)) return false;
    if (action === 'refresh') {
      if (['queued', 'running'].includes(current?.state) && folder === current.folder) return true;
      await tx.jobCloseoutRun.create({
        data: { reviewId: review.id, cycle, revision: (current?.revision ?? 0) + 1, folder, requestedBy: actor },
      });
      return true;
    }
    if (current?.state !== 'ready' || !current.report?.complete) return false;
    if (action === 'approve' ? !current.report.cleanupCount : current.report.cleanupCount > 0) return false;
    if (action === 'close' && current.report.issues.length && !note) return false;
    const updated = await tx.jobCloseoutRun.updateMany({
      where: { id: current.id, state: 'ready' },
      data: { state: action === 'approve' ? 'approved' : 'closed', note, decidedAt: new Date(), decidedBy: actor },
    });
    return updated.count === 1;
  });
}
