import { getDashboardSummary } from "@/app/dashboard/projectQueries";

export async function GET() {
  try {
    const summary = await getDashboardSummary();
    
    if (!summary) {
      return Response.json({ error: "No summary available" });
    }
    
    // Return relevant status group info
    const statuses = ['Bid Submitted', 'In Progress', 'Estimating', 'Accepted', 'Complete'];
    const statusInfo: Record<string, any> = {};
    
    statuses.forEach(status => {
      const group = summary.statusGroups[status];
      if (group) {
        statusInfo[status] = {
          hours: group.hours,
          count: group.count,
          laborGroupCount: Object.keys(group.laborByGroup || {}).length,
          sampleLaborGroups: Object.entries(group.laborByGroup || {})
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([name, hours]) => ({ name, hours }))
        };
      }
    });
    
    return Response.json({
      success: true,
      statusGroups: statusInfo,
      totalHours: summary.totalHours,
      totalProjects: Object.values(summary.statusGroups).reduce((sum, g: any) => sum + (g.count || 0), 0)
    });
  } catch (error: any) {
    return Response.json({ error: error.message });
  }
}
