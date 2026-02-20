import { NextRequest, NextResponse } from "next/server";
import { collection, setDoc, doc, getDocs } from "firebase/firestore";
import { db } from "@/firebase";

interface EmployeeImport {
  firstName: string;
  lastName: string;
  jobTitle: string;
  workPhone?: string;
  phone?: string;
  email?: string;
}

const contactListData: EmployeeImport[] = [
  { firstName: "Alvin", lastName: "Huyard", jobTitle: "Lead Foreman/Project Manager", workPhone: "(717) 442-9517", phone: "(717) 669-3379", email: "alvin@pmcdecor.com" },
  { firstName: "Jason", lastName: "Stoltzfus", jobTitle: "Foreman", workPhone: "(717) 380-2286", phone: "(412) 289-2724", email: "jason@pmcdecor.com" },
  { firstName: "Joey", lastName: "Beiler", jobTitle: "Foreman", workPhone: "(717) 517-2538", phone: "(717) 468-1506", email: "joseph@pmcdecor.com" },
  { firstName: "Matt", lastName: "King", jobTitle: "Foreman", workPhone: "(717) 305-0022", phone: "(717) 606-8990", email: "matthew@pmcdecor.com" },
  { firstName: "Omar", lastName: "Stoltzfus", jobTitle: "Foreman", workPhone: "(223) 280-9455", phone: "(717) 419-9963", email: "omar@pmcdecor.com" },
  { firstName: "Ray", lastName: "King", jobTitle: "Foreman", workPhone: "(717) 553-3322", phone: "(717) 617-4941", email: "ray@pmcdecor.com" },
  { firstName: "Ivan", lastName: "Zavaleta", jobTitle: "Right Hand Man", phone: "(484) 378-5229" },
  { firstName: "James", lastName: "King", jobTitle: "Right Hand Man", phone: "(484) 653-7558" },
  { firstName: "Matt", lastName: "Beiler", jobTitle: "Right Hand Man", phone: "(717) 208-0122" },
  { firstName: "Mose", lastName: "Zook", jobTitle: "Right Hand Man", phone: "(484) 798-7784" },
  { firstName: "Willie", lastName: "Stoltzfus", jobTitle: "Crew Leader", phone: "(717) 222-1125" },
  { firstName: "Francisco", lastName: "Romero", jobTitle: "Laborer", phone: "(610) 612-7178" },
  { firstName: "Japheth", lastName: "King", jobTitle: "Laborer", phone: "(717) 368-8196" },
  { firstName: "Jesse", lastName: "King", jobTitle: "Laborer", phone: "(717) 808-0482" },
  { firstName: "Johnny", lastName: "King", jobTitle: "Laborer", phone: "(717) 203-2060" },
  { firstName: "Jose", lastName: "Alpizar", jobTitle: "Laborer", phone: "(717) 885-4115" },
  { firstName: "Jose", lastName: "Cruz", jobTitle: "Laborer", phone: "(484) 529-6997" },
  { firstName: "Kevin", lastName: "Buch", jobTitle: "Laborer", phone: "(717) 538-6402" },
  { firstName: "Lee", lastName: "Zook", jobTitle: "Laborer", phone: "(223) 266-6280" },
  { firstName: "Logan", lastName: "Spence", jobTitle: "Laborer", phone: "(484) 905-1373" },
  { firstName: "Omar", lastName: "Garcia Cruz", jobTitle: "Laborer", phone: "(610) 803-6662" },
  { firstName: "Abner", lastName: "Stoltzfus", jobTitle: "Partner / VP Ops / Project Manager", workPhone: "(717) 381-8774", email: "abner@pmcdecor.com" },
  { firstName: "Dan", lastName: "Hess", jobTitle: "Screed Operator / CDL Driver", workPhone: "(717) 517-6692", phone: "(717) 990-9100", email: "danhess@pmcdecor.com" },
  { firstName: "Danny", lastName: "Hess", jobTitle: "Screed Operator / CDL Driver", workPhone: "(717) 913-1674", phone: "(717) 875-8421", email: "danny@pmcdecor.com" },
  { firstName: "Danny", lastName: "Jones", jobTitle: "Company Driver", workPhone: "(717) 725-4227" },
  { firstName: "Dave", lastName: "Garrett", jobTitle: "Controller / Safety", phone: "(717) 575-4664", email: "david@pmcdecor.com" },
  { firstName: "Isaac", lastName: "Stoltzfus Jr.", jobTitle: "Estimator / Quality Control", workPhone: "(717) 913-1677", phone: "(717) 553-3335", email: "isaac@pmcdecor.com" },
  { firstName: "Jane", lastName: "Dropeskey", jobTitle: "HR Manager / Payroll / Benefits", workPhone: "(717) 288-3222", phone: "(610) 618-6838", email: "jane@pmcdecor.com" },
  { firstName: "John", lastName: "Stoltzfus", jobTitle: "Partner / Proj Manager / Scheduler / HR", workPhone: "(717) 951-0573", email: "john@pmcdecor.com" },
  { firstName: "Josh", lastName: "Guidroz", jobTitle: "Shop Manager / Dispatcher", workPhone: "(717) 598-4582", phone: "(570) 703-9093", email: "josh@pmcdecor.com" },
  { firstName: "Levi", lastName: "Stoltzfus", jobTitle: "Partner / President", workPhone: "(717) 989-1564", email: "levi@pmcdecor.com" },
  { firstName: "Merv", lastName: "Allgyer", jobTitle: "Lead Project Manager", workPhone: "(717) 517-1577", phone: "(717) 690-4935", email: "mervin@pmcdecor.com" },
  { firstName: "Rick", lastName: "Steffy", jobTitle: "Partner / Sales Manager / Lead Estimator", workPhone: "(717) 405-8187", email: "rick@pmcdecor.com" },
  { firstName: "Scott", lastName: "Swinehart", jobTitle: "Mechanic", workPhone: "(717) 951-0523", email: "scott@pmcdecor.com" },
  { firstName: "Shelly", lastName: "Swinehart", jobTitle: "Office Admin / Estimator Assistant", workPhone: "(717) 288-3227", phone: "(717) 517-1482", email: "shelly@pmcdecor.com" },
  { firstName: "Todd", lastName: "Gilmore", jobTitle: "Business Office Manager", workPhone: "(717) 913-1643", phone: "(717) 802-9344", email: "todd@pmcdecor.com" },
];

export async function POST(request: NextRequest) {
  try {
    const snapshot = await getDocs(collection(db, "employees"));
    const existingEmployees = new Map(
      snapshot.docs.map(doc => [
        `${doc.data().firstName} ${doc.data().lastName}`.toLowerCase(),
        doc.data()
      ])
    );

    let added = 0;
    let updated = 0;

    for (const emp of contactListData) {
      const fullName = `${emp.firstName} ${emp.lastName}`.toLowerCase();
      const now = new Date().toISOString();
      const existing = existingEmployees.get(fullName);
      
      const employeeData = {
        firstName: emp.firstName,
        lastName: emp.lastName,
        email: emp.email || "",
        phone: emp.phone || "",
        workPhone: emp.workPhone || "",
        jobTitle: emp.jobTitle,
        isActive: true,
        createdAt: existing ? existing.createdAt : now,
        updatedAt: now,
        // Preserve existing data if employee exists
        ...(existing ? {
          department: existing.department,
          hourlyRate: existing.hourlyRate,
          vacationHours: existing.vacationHours,
          keypadCode: existing.keypadCode,
          dateOfBirth: existing.dateOfBirth,
          hireDate: existing.hireDate,
          dateOfLeave: existing.dateOfLeave,
          notes: existing.notes,
          payHistory: existing.payHistory,
          apparelRecords: existing.apparelRecords,
        } : {}),
      };

      const docId = existing 
        ? snapshot.docs.find(doc => `${doc.data().firstName} ${doc.data().lastName}`.toLowerCase() === fullName)?.id
        : `emp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      await setDoc(doc(db, "employees", docId!), employeeData);

      if (existing) {
        updated++;
      } else {
        added++;
      }
    }

    return NextResponse.json({
      success: true,
      message: `Imported employees: ${added} added, ${updated} updated`,
      added,
      updated,
      total: added + updated,
    });
  } catch (error) {
    console.error("Bulk import error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
