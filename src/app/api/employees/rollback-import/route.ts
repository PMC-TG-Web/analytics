import { NextRequest, NextResponse } from "next/server";
import { collection, getDocs, deleteDoc, doc } from "firebase/firestore";
import { db } from "@/firebase";

// The names from the contact list import
const importedNames = [
  "Alvin Huyard", "Jason Stoltzfus", "Joey Beiler", "Matt King", "Omar Stoltzfus", 
  "Ray King", "Ivan Zavaleta", "James King", "Matt Beiler", "Mose Zook", 
  "Willie Stoltzfus", "Francisco Romero", "Japheth King", "Jesse King", "Johnny King", 
  "Jose Alpizar", "Jose Cruz", "Kevin Buch", "Lee Zook", "Logan Spence", 
  "Omar Garcia Cruz", "Abner Stoltzfus", "Dan Hess", "Danny Hess", "Danny Jones", 
  "Dave Garrett", "Isaac Stoltzfus Jr.", "Jane Dropeskey", "John Stoltzfus", 
  "Josh Guidroz", "Levi Stoltzfus", "Merv Allgyer", "Rick Steffy", "Scott Swinehart", 
  "Shelly Swinehart", "Todd Gilmore"
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
