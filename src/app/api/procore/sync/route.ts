// src/app/api/procore/sync/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { makeRequest, procoreConfig } from '@/lib/procore';
import { collection, writeBatch, doc, getFirestore } from '@/firebaseStubs';

const db = getFirestore(undefined);


export async function POST(request: NextRequest) {
  try {
    const accessToken = request.cookies.get('procore_access_token')?.value;

    if (!accessToken) {
      return NextResponse.json({ error: 'Not authenticated with Procore' }, { status: 401 });
    }

    const companyId = procoreConfig.companyId;
    console.log(`[Procore Sync] Starting sync for company ${companyId}`);

    // Fetch all statuses to ensure we get "Bid submitted", etc.
    const statuses = ['ESTIMATING', 'BIDDING', 'BID_SUBMITTED', 'NEGOTIATING', 'WON', 'LOST', 'DECLINED'];
    const statusFilter = `&filters[status][]=${statuses.join('&filters[status][]=')}`;

    // 1. Fetch data from BOTH endpoints to get the full picture
    const [bidBoardResponse, coreProjectsResponse] = await Promise.all([
      makeRequest(`/rest/v2.0/companies/${companyId}/estimating/bid_board_projects?per_page=100${statusFilter}`, accessToken),
      makeRequest(`/rest/v1.1/projects?company_id=${companyId}&view=extended&per_page=100&filters[active]=any`, accessToken)
    ]);

    const bidProjects = Array.isArray(bidBoardResponse) ? bidBoardResponse : (bidBoardResponse?.data || []);
    const coreProjects = Array.isArray(coreProjectsResponse) ? coreProjectsResponse : [];

    console.log(`[Procore Sync] Found ${bidProjects.length} bids and ${coreProjects.length} core projects`);

    // Combine them
    const allProjects = [...bidProjects, ...coreProjects];

    if (allProjects.length === 0) {
      return NextResponse.json({ message: 'No projects found to sync' });
    }

    return handleSync(allProjects);

    async function handleSync(projectList: any[]) {
      console.log(`[Procore Sync] Fetched ${projectList.length} projects from Procore`);

      // 2. Prepare Firestore synchronization
      const projectsRef = collection(db, 'projects');
      const batch = writeBatch(db);
      let updateCount = 0;
      
      for (const p of projectList) {
        // Map Procore fields to our Firestore schema
        const projectName = p.name || 'Unknown Project';
        const projectNumber = p.project_number || '';
        const status = p.status || 'Unknown';
        const sales = p.stats?.total || 0;
        const dateCreated = p.created_on ? new Date(p.created_on).toLocaleDateString() : '';
        const dateUpdated = p.last_status_change ? new Date(p.last_status_change).toLocaleDateString() : '';
        
        // Find a customer name - try several common Procore field names
        const customer = p.customer_name || p.client_name || p.customer?.name || p.client?.name || 'Procore Bid Board';

        const procoreId = String(p.id);
        const docId = `procore_${procoreId}`;

        const projectData = {
          projectName,
          projectNumber,
          customer,
          status: status.replace(/_/g, ' '), // e.g. IN_PROGRESS -> IN PROGRESS
          sales,
          hours: p.stats?.total_hours || 0,
          cost: 0,
          pmcGroup: 'Procore Sync',
          costItem: 'Project Summary',
          dateCreated,
          dateUpdated,
          procoreId,
          source: 'procore_bidboard',
          updatedAt: new Date().toISOString()
        };

        batch.set(doc(projectsRef, docId), projectData, { merge: true });
        updateCount++;
      }

      await batch.commit();
      console.log(`[Procore Sync] Successfully synced ${updateCount} projects`);

      return NextResponse.json({ 
        success: true, 
        count: updateCount,
        message: `Successfully synced ${updateCount} projects from Procore Bid Board.`
      });
    }


  } catch (error) {
    console.error('[Procore Sync] Error:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Unknown sync error' 
    }, { status: 500 });
  }
}
