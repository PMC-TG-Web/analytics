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

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const year = searchParams.get('year') || '2026';
    
    const projects = await getAllProjectsForDashboard();
    
    console.log(`[DEBUG] Total projects loaded: ${projects.length}`);
    
    // Filter to Bid Submitted/Estimating
    const bidSubmittedProjects = projects.filter(p => 
      p.status === 'Bid Submitted' || p.status === 'Estimating'
    );
    console.log(`[DEBUG] Bid Submitted/Estimating projects: ${bidSubmittedProjects.length}`);
    
    // Same logic as KPI page
    const bidSubmittedSalesByMonth: Record<string, number> = {};
    const bidSubmittedHoursByMonth: Record<string, number> = {};
    
    let bidSubmittedTotal = 0;
    let bidSubmittedWithDates = 0;
    let bidSubmittedWithoutDates = 0;
    
    projects.forEach((project) => {
      const status = (project.status || "").trim();
      if (status !== "Bid Submitted" && status !== "Estimating") return;
      
      const sales = Number(project.sales ?? 0);
      bidSubmittedTotal += sales;
      
      const projectDate = getProjectDate(project);
      if (!projectDate) {
        bidSubmittedWithoutDates++;
        return;
      }
      
      // Filter by year
      if (projectDate.getFullYear().toString() !== year) return;
      
      bidSubmittedWithDates++;
      
      const monthKey = `${projectDate.getFullYear()}-${String(projectDate.getMonth() + 1).padStart(2, "0")}`;
      if (!Number.isFinite(sales)) return;
      
      bidSubmittedSalesByMonth[monthKey] = (bidSubmittedSalesByMonth[monthKey] || 0) + sales;
      
      const hours = Number(project.hours ?? 0);
      if (Number.isFinite(hours)) {
        bidSubmittedHoursByMonth[monthKey] = (bidSubmittedHoursByMonth[monthKey] || 0) + hours;
      }
    });
    
    console.log(`[DEBUG] Total Bid Submitted sales: $${bidSubmittedTotal.toLocaleString()}`);
    console.log(`[DEBUG] With dates in year ${year}: ${bidSubmittedWithDates}`);
    
    // Build monthly breakdown with details
    const monthlyBreakdown = Object.entries(bidSubmittedSalesByMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([monthKey, sales]) => ({
        month: monthKey,
        sales: sales,
        hours: bidSubmittedHoursByMonth[monthKey] || 0,
        formattedSales: `$${sales.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
      }));
    
    // Calculate cumulative
    let cumulativeSales = 0;
    const cumulativeByMonth = monthlyBreakdown.map(m => {
      cumulativeSales += m.sales;
      return {
        ...m,
        cumulativeSales: cumulativeSales,
        formattedCumulativeSales: `$${cumulativeSales.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
      };
    });
    
    return Response.json({
      success: true,
      year,
      bidSubmittedMetrics: {
        totalAllYears: bidSubmittedTotal,
        withDatesInYear: bidSubmittedWithDates,
        withoutDates: bidSubmittedWithoutDates,
        formattedTotal: `$${bidSubmittedTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
      },
      monthlyBreakdown: cumulativeByMonth
    });
  } catch (error: any) {
    console.error('[DEBUG] Error:', error);
    return Response.json({ error: error.message, stack: error.stack });
  }
}
