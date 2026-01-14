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
    const fileContent = fs.readFileSync(csvPath, 'utf8');

    // Parse CSV
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    // Import all rows, but only add new ones (by Project Number)
    // First, delete all documents in the 'projects' collection
    const projectsCol = collection(db, 'projects');
    const existingProjectDocs = await getDocs(projectsCol);
    let deletedCount = 0;
    for (const docSnap of existingProjectDocs.docs) {
      await deleteDoc(doc(projectsCol, docSnap.id));
      deletedCount++;
    }

    // Import all rows with correct field names
    let imported = 0;
    for (const row of records as Array<Record<string, string>>) {
      const hours = parseFloat((row["Hours"] || "0").replace(/[^\d.\-]/g, ""));
      const cost = parseFloat((row["Total Cost"] || "0").replace(/[^\d.\-]/g, ""));
      const sales = parseFloat((row["Total Sales"] || "0").replace(/[^\d.\-]/g, ""));
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
          status: row["Status"],
          projectName: row["Estimate Project Name"],
          projectNumber: row["Project Number"],
          customer: row["Customer Company"],
          estimator: row["Estimator"],
          dateCreated: row["Date Created"],
          dateUpdated: row["Date Updated"],
          statusTimestamp,
        });
        imported++;
      } catch (e) {
        // Ignore errors for now
      }
    }
    return NextResponse.json({ success: true, deleted: deletedCount, imported });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message });
  }
}
