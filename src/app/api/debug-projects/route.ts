import { getAllProjectsForDashboard } from "@/lib/firebaseAdapter";

export async function GET() {
  try {
    const projects = await getAllProjectsForDashboard();
    
    return Response.json({
      projectCount: projects.length,
      sampleProject: projects.length > 0 ? {
        projectName: projects[0].projectName,
        status: projects[0].status,
        sales: projects[0].sales,
        dateCreated: projects[0].dateCreated
      } : null,
      statusBreakdown: projects.reduce((acc, p) => {
        const status = p.status || 'Unknown';
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      }, {} as Record<string, number>)
    });
  } catch (error: any) {
    return Response.json({ error: error.message });
  }
}
