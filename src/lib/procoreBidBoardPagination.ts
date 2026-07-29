export function shouldStopBidBoardPagination(params: {
  pageItemCount: number;
  newProjectCount: number;
}): boolean {
  return params.pageItemCount === 0 || params.newProjectCount === 0;
}
