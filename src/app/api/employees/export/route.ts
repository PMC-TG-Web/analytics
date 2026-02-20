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
      
      // Add logo at top center (letterhead style) - smaller and higher
      doc.addImage(logoBase64, 'PNG', 85, 5, 40, 16); // x, y, width, height
    } catch (error) {
      console.error("Error loading logo:", error);
      // Continue without logo if it fails to load
    }
    
    // Add horizontal line
    doc.setDrawColor(20, 184, 166);
    doc.setLineWidth(0.5);
    doc.line(14, 23, 196, 23);
    
    // Add title in teal
    doc.setFontSize(12);
    doc.setTextColor(20, 184, 166); // Teal color
    doc.text("Employee Contact List", 105, 29, { align: 'center' });
    
    // Add date only (smaller, inline with title area)
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    doc.text(`Generated: ${today}`, 14, 29);
    
    // Add table - start much higher to fit everything on one page
    autoTable(doc, {
      startY: 33,
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
        fontSize: 8
      },
      styles: {
        fontSize: 7,
        cellPadding: 1.5,
        lineWidth: 0.1,
      },
      columnStyles: {
        0: { cellWidth: 32 }, // Name
        1: { cellWidth: 28 }, // Job Title
        2: { cellWidth: 32 }, // Work Phone
        3: { cellWidth: 32 }, // Personal Phone
        4: { cellWidth: 'auto' } // Email
      },
      margin: { left: 14, right: 14, bottom: 14 },
      pageBreak: 'avoid'
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
