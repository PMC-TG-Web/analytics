import { NextRequest, NextResponse } from "next/server";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/firebase";

function formatPhoneNumber(phone: string): string {
  if (!phone) return "";
  
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, "");
  
  // Remove leading 1 if present
  const cleanDigits = digits.startsWith("1") && digits.length === 11 ? digits.substring(1) : digits;
  
  // Format as (XXX) XXX-XXXX if we have 10 digits
  if (cleanDigits.length === 10) {
    return `(${cleanDigits.substring(0, 3)}) ${cleanDigits.substring(3, 6)}-${cleanDigits.substring(6)}`;
  }
  
  // Return original if not 10 digits
  return phone;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const includeInactive = searchParams.get('includeInactive') === 'true';
    
    const snapshot = await getDocs(collection(db, "employees"));
    
    // Build CSV with specific columns
    const csvRows = [];
    csvRows.push("Name,Job Title,Work Phone,Personal Phone,Work Email");
    
    snapshot.forEach((doc) => {
      const data = doc.data();
      
      // Filter out inactive employees if not included
      if (!includeInactive && data.isActive === false) {
        return;
      }
      const name = `${data.firstName || ''} ${data.lastName || ''}`.trim();
      const jobTitle = data.jobTitle || '';
      const workPhone = formatPhoneNumber(data.workPhone || '');
      const personalPhone = formatPhoneNumber(data.phone || '');
      const email = data.email || '';
      
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
        escapeCsv(email)
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
