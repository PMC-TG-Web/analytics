import { NextRequest, NextResponse } from "next/server";

import { db } from "@/firebase";

import { getDocs, collection, setDoc, doc, getDoc, deleteDoc, updateDoc, addDoc, writeBatch, query, where } from '@/firebaseStubs';
// The names from the Company Directory import
const importedNames = [
  "Mervin Allgyer", "Jose Alpizar", "Joseph Beiler", "Matt Beiler", "Kevin Buch", 
  "Omar Garcia Cruz", "Jose Cruz-Loaeza", "Jane Dropeskey", "Francisco Garcia Romero", 
  "David Garrett", "Todd Gilmore", "Joshua Guidroz", "Daniel Hess", "Daniel Hess (son)", 
  "Alvin Huyard", "Danny Jones", "James King", "Japheth King", "Jesse King", "John King", 
  "Matthew King", "Raymond King Jr", "Logan Spence", "Rick Steffy", "Abner Stoltzfus", 
  "Jason Stoltzfus", "John Stoltzfus", "Levi Stoltzfus", "Omar Stoltzfus", "William Stoltzfus", 
  "Isaac Stoltzfus Jr", "Scott Swinehart", "Shelly Swinehart", "Ivan Zavaleta Lopez", 
  "Lee Zook", "Mose Zook"
];

export async function POST(request: NextRequest) {
  try {
    const snapshot = await getDocs(collection(db, "employees"));
    let deleted = 0;
    const deletedNames: string[] = [];

    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      const fullName = `${data.firstName} ${data.lastName}`;
      
      // Check if this employee was in the import list
      if (importedNames.includes(fullName)) {
        await deleteDoc(doc(db, "employees", docSnap.id));
        deleted++;
        deletedNames.push(fullName);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Rollback complete: deleted ${deleted} employees`,
      deleted,
      deletedNames,
    });
  } catch (error) {
    console.error("Rollback error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

