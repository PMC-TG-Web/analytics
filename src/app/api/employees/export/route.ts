import { NextRequest, NextResponse } from "next/server";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/firebase";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const includeInactive = searchParams.get('includeInactive') === 'true';
    
    const snapshot = await getDocs(collection(db, "employees"));
    
    // Build CSV with specific columns
    const csvRows = [];
    csvRows.push("Name,Job Title,Work Phone,Personal Phone,Work Email,Status");
    
    snapshot.forEach((doc) => {
      const data = doc.data();
      
      // Filter out inactive employees if not included
      if (!includeInactive && data.isActive === false) {
        return;
      }
      const name = `${data.firstName || ''} ${data.lastName || ''}`.trim();
      const jobTitle = data.jobTitle || '';
      const workPhone = data.workPhone || '';
      const personalPhone = data.phone || '';
      const email = data.email || '';
      const status = data.isActive === false ? 'Inactive' : 'Active';
      
      // Escape fields that might contain commas
      const escapeCsv = (field: string) => {
        if (field.includes(',') || field.includes('"') || field.includes('\n')) {
          return `"${field.replace(/"/g, '""')}"`;
        }
        return field;
      };
      
      csvRows.push([
        escapeCsv(name),
        escapeCsv(jobTitle),
        escapeCsv(workPhone),
        escapeCsv(personalPhone),
        escapeCsv(email),
        escapeCsv(status)
      ].join(','));
    });
    
    const csvContent = csvRows.join('\n');
    
    return new NextResponse(csvContent, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="employee-contact-list-${new Date().toISOString().split('T')[0]}.csv"`,
      },
    });
  } catch (error) {
    console.error("Export error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
