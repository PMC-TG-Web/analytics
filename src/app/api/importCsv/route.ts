import { NextResponse } from 'next/server';

import { db } from '@/firebase';
import { getDocs, collection, setDoc, doc, getDoc, deleteDoc, updateDoc, addDoc, writeBatch, query, where } from '@/firebaseStubs';
import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';

export async function GET() {
  try {
    // Path to the CSV file
    const csvPath = path.join(process.cwd(), 'src', 'Bid_Distro-Preconstruction.csv');
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
      const hours = parseFloat(String(row["hours"] || "0").replace(/[^\d.\-]/g, "")) || 0;
      const cost = parseFloat(String(row["cost"] || "0").replace(/[^\d.\-]/g, "")) || 0;
      const sales = parseFloat(String(row["sales"] || "0").replace(/[^\d.\-]/g, "")) || 0;
      
      const status = row["status"] ? String(row["status"]).trim() : null;
      const projectName = row["projectName"] ? String(row["projectName"]).trim() : null;
      const projectNumber = row["projectNumber"] ? String(row["projectNumber"]).trim() : null;
      const customer = row["customer"] ? String(row["customer"]).trim() : null;
      const estimator = row["estimator"] ? String(row["estimator"]).trim() : null;
      const costitems = row["Costitems"] ? String(row["Costitems"]).trim() : null;
      const costType = row["CostType"] ? String(row["CostType"]).trim() : null;
      const quantity = parseFloat(String(row["Quantity"] || "0").replace(/[^\d.\-]/g, "")) || 0;
      const pmcGroup = row["PMCGroup"] ? String(row["PMCGroup"]).trim() : null;
      
      const dateCreated = row["dateCreated"] || null;
      const dateUpdated = row["dateUpdated"] || null;
      const scopeOfWork = row["ScopeOfWork"] || null;
      const projectArchived = row["ProjectArchived"] === "Yes";
      
      try {
        // Use dateUpdated if available, else dateCreated, as the status timestamp
        let statusTimestamp = row["dateUpdated"] || row["dateCreated"] || null;
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
          pmcGroup,
          dateCreated,
          dateUpdated,
          statusTimestamp,
          scopeOfWork,
          projectArchived
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

