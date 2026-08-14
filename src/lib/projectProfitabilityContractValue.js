function finiteNumber(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundCurrency(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundPercent(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function resolveProjectContractValue({
  procoreProjectId,
  procoreBaseEstimate,
  procoreApprovedChangeOrders,
  qboEstimateTotal,
  netBilled,
}) {
  const hasProcoreProject = String(procoreProjectId || '').trim().length > 0;
  const baseEstimate = finiteNumber(procoreBaseEstimate);
  const approvedChangeOrders = finiteNumber(procoreApprovedChangeOrders) ?? 0;
  const qboEstimate = finiteNumber(qboEstimateTotal);
  const billed = finiteNumber(netBilled);

  let contractValue = null;
  let contractValueSource = 'unavailable';

  if (hasProcoreProject) {
    contractValueSource = baseEstimate == null ? 'procore-unavailable' : 'procore';
    if (baseEstimate != null) {
      contractValue = roundCurrency(baseEstimate + approvedChangeOrders);
    }
  } else if (qboEstimate != null) {
    contractValue = roundCurrency(qboEstimate);
    contractValueSource = 'qbo-estimates';
  }

  return {
    contractValue,
    contractValueSource,
    procoreBaseEstimate: hasProcoreProject && baseEstimate != null
      ? roundCurrency(baseEstimate)
      : null,
    procoreApprovedChangeOrders: hasProcoreProject && baseEstimate != null
      ? roundCurrency(approvedChangeOrders)
      : null,
    billingProgressPercent: contractValue != null && contractValue !== 0 && billed != null
      ? roundPercent((billed / contractValue) * 100)
      : null,
    remainingToBill: contractValue != null && billed != null
      ? roundCurrency(contractValue - billed)
      : null,
  };
}
