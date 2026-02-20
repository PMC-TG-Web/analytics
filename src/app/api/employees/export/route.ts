import { NextRequest, NextResponse } from "next/server";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/firebase";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import fs from "fs";
import path from "path";

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
    
    // Collect employee data
    const employees: any[] = [];
    
    snapshot.forEach((doc) => {
      const data = doc.data();
      
      // Filter out inactive employees if not included
      if (!includeInactive && data.isActive === false) {
        return;
      }
      
      employees.push({
        name: `${data.firstName || ''} ${data.lastName || ''}`.trim(),
        jobTitle: data.jobTitle || '',
        workPhone: formatPhoneNumber(data.workPhone || ''),
        personalPhone: formatPhoneNumber(data.phone || ''),
        email: data.email || ''
      });
    });
    
    // Sort employees by name
    employees.sort((a, b) => a.name.localeCompare(b.name));
    
    // Create PDF
    const doc = new jsPDF();
    
    // Load and add logo as letterhead
    try {
      const logoPath = path.join(process.cwd(), 'public', 'logo.png');
      const logoData = fs.readFileSync(logoPath);
      const logoBase64 = `data:image/png;base64,${logoData.toString('base64')}`;
      
      // Add logo at top center (letterhead style)
      doc.addImage(logoBase64, 'PNG', 80, 10, 50, 20); // x, y, width, height
    } catch (error) {
      console.error("Error loading logo:", error);
      // Continue without logo if it fails to load
    }
    
    // Add company name below logo
    doc.setFontSize(18);
    doc.setTextColor(20, 184, 166); // Teal color
    doc.text("PMC Decor", 105, 38, { align: 'center' });
    
    // Add horizontal line
    doc.setDrawColor(20, 184, 166);
    doc.setLineWidth(0.5);
    doc.line(14, 42, 196, 42);
    
    // Add title
    doc.setFontSize(16);
    doc.setTextColor(0, 0, 0);
    doc.text("Employee Contact List", 105, 52, { align: 'center' });
    
    // Add date and count
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    doc.text(`Generated: ${today}`, 14, 60);
    doc.text(`Total Employees: ${employees.length}`, 14, 66);
    
    // Add table
    autoTable(doc, {
      startY: 72,
      head: [['Name', 'Job Title', 'Work Phone', 'Personal Phone', 'Work Email']],
      body: employees.map(emp => [
        emp.name,
        emp.jobTitle,
        emp.workPhone,
        emp.personalPhone,
        emp.email
      ]),
      theme: 'striped',
      headStyles: {
        fillColor: [20, 184, 166], // Teal color
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 10
      },
      styles: {
        fontSize: 9,
        cellPadding: 3,
      },
      columnStyles: {
        0: { cellWidth: 35 }, // Name
        1: { cellWidth: 30 }, // Job Title
        2: { cellWidth: 35 }, // Work Phone
        3: { cellWidth: 35 }, // Personal Phone
        4: { cellWidth: 'auto' } // Email
      },
      margin: { left: 14, right: 14 }
    });
    
    // Convert PDF to buffer
    const pdfBuffer = Buffer.from(doc.output('arraybuffer'));
    
    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="employee-contact-list-${new Date().toISOString().split('T')[0]}.pdf"`,
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
