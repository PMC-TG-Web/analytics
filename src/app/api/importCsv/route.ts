import { NextResponse } from 'next/server';
import { collection, addDoc, getDocs, deleteDoc, doc } from 'firebase/firestore';
import { db } from '@/firebase';
import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';

export async function GET() {
  try {
    // Path to the CSV file
    const csvPath = path.join(process.cwd(), 'Bid_Distro_Hours.csv');
    let fileContent;
    try {
      fileContent = fs.readFileSync(csvPath, 'utf8');
    } catch (fileErr) {
      console.error('Error reading CSV file:', fileErr);
      const errorMessage = fileErr instanceof Error ? fileErr.message : 'Unknown error';
      return NextResponse.json({ success: false, error: 'CSV file read error', details: errorMessage });
    }

    // Parse CSV
    let records;
    try {
      records = parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });
    } catch (parseErr) {
      console.error('Error parsing CSV:', parseErr);
      const errorMessage = parseErr instanceof Error ? parseErr.message : 'Unknown error';
      return NextResponse.json({ success: false, error: 'CSV parse error', details: errorMessage });
    }

    // Import all rows, but only add new ones (by Project Number)
    // First, delete all documents in the 'projects' collection
    const projectsCol = collection(db, 'projects');
    let existingProjectDocs;
    try {
      existingProjectDocs = await getDocs(projectsCol);
    } catch (dbErr) {
      console.error('Error accessing Firestore:', dbErr);
      const errorMessage = dbErr instanceof Error ? dbErr.message : 'Unknown error';
      return NextResponse.json({ success: false, error: 'Firestore access error', details: errorMessage });
    }
    let deletedCount = 0;
    for (const docSnap of existingProjectDocs.docs) {
      try {
        await deleteDoc(doc(projectsCol, docSnap.id));
        deletedCount++;
      } catch (delErr) {
        console.error('Error deleting Firestore document:', delErr);
      }
    }

    // Import all rows with correct field names
    let imported = 0;
    for (const row of records as Array<Record<string, string>>) {
      const hours = parseFloat((row["Hours"] || "0").replace(/[^\d.\-]/g, ""));
      const cost = parseFloat((row["Total Cost"] || "0").replace(/[^\d.\-]/g, ""));
      const sales = parseFloat((row["Total Sales"] || "0").replace(/[^\d.\-]/g, ""));
      const costitems = (typeof row["Costitems"] === "undefined" || row["Costitems"] === "") ? null : row["Costitems"];
      const costType = (typeof row["CostType"] === "undefined" || row["CostType"] === "") ? null : row["CostType"];
      const quantity = parseFloat((row["Quantity"] || "0").replace(/[^\d.\-]/g, ""));
      const status = (typeof row["Status"] === "undefined" || row["Status"] === "") ? null : row["Status"];
      const projectName = (typeof row["Estimate Project Name"] === "undefined" || row["Estimate Project Name"] === "") ? null : row["Estimate Project Name"];
      const projectNumber = (typeof row["Project Number"] === "undefined" || row["Project Number"] === "") ? null : row["Project Number"];
      const customer = (typeof row["Customer Company"] === "undefined" || row["Customer Company"] === "") ? null : row["Customer Company"];
      const estimator = (typeof row["Estimator"] === "undefined" || row["Estimator"] === "") ? null : row["Estimator"];
      const dateCreated = (typeof row["Date Created"] === "undefined" || row["Date Created"] === "") ? null : row["Date Created"];
      const dateUpdated = (typeof row["Date Updated"] === "undefined" || row["Date Updated"] === "") ? null : row["Date Updated"];
      try {
        // Use dateUpdated if available, else dateCreated, as the status timestamp
        let statusTimestamp = row["Date Updated"] || row["Date Created"] || null;
        if (statusTimestamp) {
          const d = new Date(statusTimestamp);
          if (!isNaN(d.getTime())) statusTimestamp = d.toISOString();
        }
        await addDoc(projectsCol, {
          hours,
          cost,
          sales,
          costitems,
          costType,
          quantity,
          status,
          projectName,
          projectNumber,
          customer,
          estimator,
          dateCreated,
          dateUpdated,
          statusTimestamp,
        });
        imported++;
      } catch (e) {
        console.error('Error adding Firestore document:', e, row);
      }
    }
    return NextResponse.json({ success: true, deleted: deletedCount, imported });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message });
  }
}
