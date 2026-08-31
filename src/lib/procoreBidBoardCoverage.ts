const DEFAULT_MINIMUM_COVERAGE = 0.98;

export function assessBidBoardCoverage(params: {
  fetchedRows: number;
  expectedVisibleRows: number;
  minimumCoverage?: number;
}) {
  const fetchedRows = Math.max(0, Math.trunc(params.fetchedRows));
  const expectedVisibleRows = Math.max(0, Math.trunc(params.expectedVisibleRows));
  const minimumCoverage = Number.isFinite(params.minimumCoverage)
    ? Math.min(1, Math.max(0, Number(params.minimumCoverage)))
    : DEFAULT_MINIMUM_COVERAGE;
  const coverage = expectedVisibleRows > 0 ? fetchedRows / expectedVisibleRows : 1;

  return {
    coverage,
    complete: fetchedRows > 0 && coverage >= minimumCoverage,
  };
}
