// API endpoint to sync Procore productivity logs to database
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { makeRequest } from "@/lib/procore";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { 
      projectId = "598134326278124",
      startDate = "2025-08-01",
      endDate = new Date().toISOString().split('T')[0],
      page = 1,
      perPage = 100
    } = body;

    // Get access token from cookies
    const cookieStore = await cookies();
    const cookieToken = cookieStore.get("procore_access_token")?.value;
    const { accessToken: bodyToken } = body;
    const accessToken = cookieToken || bodyToken;

    if (!accessToken) {
      return NextResponse.json(
        { error: "Missing access token. Please authenticate via OAuth first." },
        { status: 401 }
      );
    }

    // Fetch all productivity logs from Procore
    console.log(`Syncing Procore productivity logs for project ${projectId}`);
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let allLogs: any[] = [];
    let currentPage = page;
    let hasMore = true;

    // Paginate through all results
    while (hasMore) {
      const endpoint = `/rest/v1.0/projects/${projectId}/productivity_logs?start_date=${startDate}&end_date=${endDate}&page=${currentPage}&per_page=${perPage}`;
      const logs = await makeRequest(endpoint, accessToken);
      
      if (Array.isArray(logs) && logs.length > 0) {
        allLogs = allLogs.concat(logs);
        console.log(`Fetched ${logs.length} logs from page ${currentPage}`);
        
        // If we got fewer than perPage, we're on the last page
        if (logs.length < perPage) {
          hasMore = false;
        } else {
          currentPage++;
        }
      } else {
        hasMore = false;
      }
    }

    console.log(`Total logs fetched: ${allLogs.length}`);

    // Get the project from database (or find by Procore ID)
    const dbProject = await prisma.project.findFirst({
      where: {
        projectNumber: projectId
      }
    });

    // Prepare data for database insertion
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const logsToCreate = allLogs.map((log: any) => ({
      projectId: dbProject?.id,
      jobKey: dbProject?.projectNumber,
      date: new Date(log.date || log.log_date),
      foreman: log.foreman_name || log.foreman,
      crew: log.crew_name || log.crew,
      hours: parseFloat(log.hours) || 0,
      scopeOfWork: log.scope_of_work || log.description,
      notes: log.notes,
      customFields: {
        procoreId: log.id,
        procoreProjectId: projectId,
        originalData: log
      }
    }));

    console.log(`Preparing to save ${logsToCreate.length} logs to database`);

    // Save logs to database with upsert to avoid duplicates
    let savedCount = 0;
    for (const logData of logsToCreate) {
      try {
        await prisma.productivityLog.upsert({
          where: {
            id: logData.customFields.procoreId // Use Procore ID as unique identifier
          },
          update: logData,
          create: {
            ...logData,
            id: logData.customFields.procoreId // Use Procore ID as the record ID
          }
        });
        savedCount++;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (_ ) {
        // If upsert fails, try regular create
        try {
          await prisma.productivityLog.create({
            data: {
              ...logData,
              id: undefined // Let it generate a new ID
            }
          });
          savedCount++;
        } catch (innerErr) {
          console.error("Error saving log:", innerErr);
        }
      }
    }

    console.log(`Saved ${savedCount} logs to database`);

    return NextResponse.json({
      success: true,
      message: `Synced ${savedCount} productivity logs`,
      projectId,
      startDate,
      endDate,
      totalFetched: allLogs.length,
      totalSaved: savedCount,
      dbProject: dbProject ? {
        id: dbProject.id,
        projectName: dbProject.projectName,
        projectNumber: dbProject.projectNumber
      } : null
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Procore sync API error:", message);
    
    return NextResponse.json(
      { 
        error: "Failed to sync Procore productivity logs", 
        details: message 
      },
      { status: 500 }
    );
  } finally {
    await prisma.$disconnect();
  }
}
