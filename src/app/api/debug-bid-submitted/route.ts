import { getAllProjectsForDashboard } from "@/lib/firebaseAdapter";

function parseDateValue(value: any) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "string") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "object" && typeof value.toDate === "function") {
    const d = value.toDate();
    return d instanceof Date && !isNaN(d.getTime()) ? d : null;
  }
  return null;
}

function getProjectDate(project: any) {
  const created = parseDateValue(project.dateCreated);
  const updated = parseDateValue(project.dateUpdated);
  if (created) return created;
  return updated || null;
}

export async function GET() {
  try {
    const projects = await getAllProjectsForDashboard();
    
    // Filter to Bid Submitted only
    const bidSubmitted = projects.filter(p => 
      (p.status === 'Bid Submitted' || p.status === 'Estimating') && !p.projectArchived
    );
    
    // Build daily breakdown for January
    const dailyByDate: Record<string, { count: number; sales: number; projects: any[] }> = {};
    
    bidSubmitted.forEach(project => {
      const projectDate = getProjectDate(project);
      if (!projectDate) return;
      
      // Only include January dates
      if (projectDate.getMonth() !== 0) return; // January is month 0
      
      const dateStr = projectDate.toISOString().split('T')[0]; // YYYY-MM-DD
      
      if (!dailyByDate[dateStr]) {
        dailyByDate[dateStr] = { count: 0, sales: 0, projects: [] };
      }
      
      const sales = Number(project.sales ?? 0);
      dailyByDate[dateStr].count += 1;
      dailyByDate[dateStr].sales += sales;
      dailyByDate[dateStr].projects.push({
        projectName: project.projectName,
        sales: sales,
        dateCreated: projectDate.toISOString().split('T')[0]
      });
    });
    
    // Calculate cumulative by Jan 26
    let cumulativeByJan26 = 0;
    let countByJan26 = 0;
    
    Object.entries(dailyByDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([dateStr, data]) => {
        if (dateStr <= '2026-01-26') {
          cumulativeByJan26 += data.sales;
          countByJan26 += data.count;
        }
      });
    
    return Response.json({
      success: true,
      bidSubmittedCount: bidSubmitted.length,
      dailyBreakdown: dailyByDate,
      cumulativeByJan26: {
        sales: cumulativeByJan26,
        count: countByJan26,
        formattedSales: `$${cumulativeByJan26.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
      }
    });
  } catch (error: any) {
    return Response.json({ error: error.message });
  }
}
