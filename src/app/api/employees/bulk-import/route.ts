import { NextRequest, NextResponse } from "next/server";
import { collection, setDoc, doc, getDocs } from "firebase/firestore";
import { db } from "@/firebase";

interface EmployeeImport {
  firstName: string;
  lastName: string;
  jobTitle: string;
  country?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  workPhone?: string;
  phone?: string;
  email?: string;
  personalEmail?: string;
}

const companyDirectoryData: EmployeeImport[] = [
  { firstName: "Mervin", lastName: "Allgyer", jobTitle: "Project Manager", country: "United States", address: "5828 Old Philadelphia Pike", city: "Gap", state: "Pennsylvania", zip: "17527", workPhone: "(717) 517-1577", phone: "17176904935", email: "mervin@pmcdecor.com", personalEmail: "mervin@pmcdecor.com" },
  { firstName: "Jose", lastName: "Alpizar", jobTitle: "Laborer", country: "United States", address: "448 Washington Ave", city: "Parkesburg", state: "Pennsylvania", zip: "19365", phone: "(717) 885-4115", email: "josemk5@icloud.com", personalEmail: "josemk5@icloud.com" },
  { firstName: "Joseph", lastName: "Beiler", jobTitle: "Foreman", country: "United States", address: "5649 Meadeville Rd", city: "Gap", state: "Pennsylvania", zip: "17527", workPhone: "(717) 517-2538", phone: "(717) 468-1506", email: "joseph@pmcdecor.com", personalEmail: "joseph@pmcdecor.com" },
  { firstName: "Matt", lastName: "Beiler", jobTitle: "Right Hand Man", country: "United States", address: "507 A Beechdale Rd", city: "Bird in Hand", state: "Pennsylvania", zip: "17505", phone: "(717) 208-0122", email: "mattbeiler17@icloud.com", personalEmail: "mattbeiler17@icloud.com" },
  { firstName: "Kevin", lastName: "Buch", jobTitle: "Laborer", country: "United States", address: "1014 Marshall Avenue", city: "Lancaster", state: "Pennsylvania", zip: "17601", phone: "(717) 538-6402", email: "kevinebuch@gmail.com", personalEmail: "kevinebuch@gmail.com" },
  { firstName: "Omar Garcia", lastName: "Cruz", jobTitle: "Laborer", country: "United States", address: "125 Rosehill Rd", city: "West Grove", state: "Pennsylvania", zip: "19390", phone: "(610) 803-6662", email: "omar.gar06@icloud.com", personalEmail: "omar.gar06@icloud.com" },
  { firstName: "Jose", lastName: "Cruz-Loaeza", jobTitle: "Laborer", country: "United States", address: "1259 Doe Run Rd", city: "Coastesville", state: "Pennsylvania", zip: "19320", phone: "(484) 529-6997", email: "cruzzz610@icloud.com", personalEmail: "cruzzz610@icloud.com" },
  { firstName: "Jane", lastName: "Dropeskey", jobTitle: "HR Manager", country: "United States", address: "145 McCarter Lane", city: "Strasburg", state: "Pennsylvania", zip: "17579", workPhone: "(717) 288-3222", phone: "(717) 327-0525", email: "jane@pmcdecor.com", personalEmail: "jane@pmcdecor.com" },
  { firstName: "Francisco", lastName: "Garcia Romero", jobTitle: "Laborer", country: "United States", address: "1146 Fishing Creek Hollow Rd", city: "Quarryville", state: "Pennsylvania", phone: "(610) 612-7178", email: "ponchoromero069@gmail.com", personalEmail: "ponchoromero069@gmail.com" },
  { firstName: "David", lastName: "Garrett", jobTitle: "Controller", country: "United States", address: "305 Sawgrass Dr", city: "Millersville", state: "Pennsylvania", zip: "17551", workPhone: "(717) 288-3224", phone: "(717) 575-4664", email: "david@pmcdecor.com", personalEmail: "david@pmcdecor.com" },
  { firstName: "Todd", lastName: "Gilmore", jobTitle: "Office Operations Manager", country: "United States", address: "31 S Whisper Ln", city: "New Holland", state: "Pennsylvania", zip: "17557", phone: "17179131643", email: "todd@pmcdecor.com", personalEmail: "todd@pmcdecor.com" },
  { firstName: "Joshua", lastName: "Guidroz", jobTitle: "Shop Manager / Dispatcher", country: "United States", address: "923 Orange St, Apt 1", city: "Lancaster", state: "Pennsylvania", zip: "17602", phone: "17175984582", email: "josh@pmcdecor.com", personalEmail: "josh@pmcdecor.com" },
  { firstName: "Daniel", lastName: "Hess", jobTitle: "Screed Operator / CDL Driver", country: "United States", address: "335 Pequea Creek Rd", city: "Conestoga", state: "Pennsylvania", zip: "17516", workPhone: "(717) 517-6692", phone: "(717) 990-9100", email: "danhess@pmcdecor.com", personalEmail: "danhess@pmcdecor.com" },
  { firstName: "Daniel", lastName: "Hess (son)", jobTitle: "Screed Operator / CDL Driver", country: "United States", address: "335 Pequea Creek Rd", city: "Conestoga", state: "Pennsylvania", zip: "17516", workPhone: "(717) 913-1674", phone: "(717) 875-8421", email: "danny@pmcdecor.com", personalEmail: "danny@pmcdecor.com" },
  { firstName: "Alvin", lastName: "Huyard", jobTitle: "Lead Foreman / Project Manager", country: "United States", address: "1212 Chestnut Tree Rd", city: "Honey Brook", state: "Pennsylvania", zip: "19344", workPhone: "17176693379", email: "alvin@pmcdecor.com", personalEmail: "alvin@pmcdecor.com" },
  { firstName: "Danny", lastName: "Jones", jobTitle: "Company Driver", country: "United States", address: "23 Lancaster Ave", city: "Christiana", state: "Pennsylvania", zip: "17509", workPhone: "(717) 725-4227", phone: "(717) 687-6892", email: "dannyj717@gmail.com", personalEmail: "dannyj717@gmail.com" },
  { firstName: "James", lastName: "King", jobTitle: "Right Hand Man", country: "United States", phone: "(717) 572-0156", email: "james@pmcdecor.com", personalEmail: "james@pmcdecor.com" },
  { firstName: "Japheth", lastName: "King", jobTitle: "Laborer", country: "United States", email: "japheth@pmcdecor.com", personalEmail: "japheth@pmcdecor.com" },
  { firstName: "Jesse", lastName: "King", jobTitle: "Laborer", country: "United States", address: "1094 Gap Rd", city: "Kinzers", state: "Pennsylvania", zip: "17535", phone: "(717) 808-0482", email: "50jesseking@gmail.com", personalEmail: "50jesseking@gmail.com" },
  { firstName: "John", lastName: "King", jobTitle: "Laborer", country: "United States", address: "3365 Scenic Rd", city: "Gordonville", state: "Pennsylvania", zip: "17529", phone: "(717) 203-2060", email: "johnnydavidking852@gmail.com", personalEmail: "johnnydavidking852@gmail.com" },
  { firstName: "Matthew", lastName: "King", jobTitle: "Foreman", country: "United States", address: "291 S Kinzer Rd", city: "Paradise", state: "Pennsylvania", zip: "17562", workPhone: "(717) 305-0022", phone: "(717) 606-8990", email: "matthew@pmcdecor.com", personalEmail: "matthew@pmcdecor.com" },
  { firstName: "Raymond", lastName: "King Jr", jobTitle: "Foreman", country: "United States", address: "3365 Scenic Rd", city: "Gordonville", state: "Pennsylvania", zip: "17529", workPhone: "(717) 553-3322", phone: "(717) 617-4941", email: "ray@pmcdecor.com", personalEmail: "ray@pmcdecor.com" },
  { firstName: "Logan", lastName: "Spence", jobTitle: "Laborer", country: "United States", address: "1333 Blackhorse Hill Rd", city: "Coastesville", state: "Pennsylvania", zip: "19320", phone: "(484) 905-1373", email: "loganspence610@gmail.com", personalEmail: "loganspence610@gmail.com" },
  { firstName: "Rick", lastName: "Steffy", jobTitle: "Partner / Sales Manager", country: "United States", city: "New Providence", state: "Pennsylvania", workPhone: "(717) 405-8187", phone: "17174058187", email: "rick@pmcdecor.com", personalEmail: "rick@pmcdecor.com" },
  { firstName: "Abner", lastName: "Stoltzfus", jobTitle: "Vice President of Operations", country: "United States", state: "Pennsylvania", phone: "(717) 381-8774", email: "abner@pmcdecor.com", personalEmail: "abner@pmcdecor.com" },
  { firstName: "Jason", lastName: "Stoltzfus", jobTitle: "Forman", country: "United States", address: "76 Amy Dr", city: "Gap", state: "Pennsylvania", zip: "17527", workPhone: "(717) 380-2286", phone: "14122892724", email: "jason@pmcdecor.com", personalEmail: "jason@pmcdecor.com" },
  { firstName: "John", lastName: "Stoltzfus", jobTitle: "Project Manager", country: "United States", city: "Quarryville", state: "Pennsylvania", phone: "(717) 951-0573", email: "john@pmcdecor.com", personalEmail: "john@pmcdecor.com" },
  { firstName: "Levi", lastName: "Stoltzfus", jobTitle: "President", country: "United States", address: "2771 Lincoln HWY E", city: "Ronks", state: "Pennsylvania", zip: "17572", workPhone: "+1 7179891564", phone: "+1 7179891564", email: "levi@pmcdecor.com", personalEmail: "levi@pmcdecor.com" },
  { firstName: "Omar", lastName: "Stoltzfus", jobTitle: "Foreman", country: "United States", address: "4A Iva Rd", city: "Stras", state: "Pennsylvania", zip: "17579", phone: "(223) 280-9455", email: "omar@pmcdecor.com", personalEmail: "omar@pmcdecor.com" },
  { firstName: "William", lastName: "Stoltzfus", jobTitle: "Right Hand Man/ Sealhard Crew Leader", country: "United States", address: "780 Lime Quarry Rd", city: "Gap", state: "Pennsylvania", zip: "17527", phone: "(717) 222-1125", email: "williamstoltzfus5@gmail.com", personalEmail: "williamstoltzfus5@gmail.com" },
  { firstName: "Isaac", lastName: "Stoltzfus Jr", jobTitle: "Estimator 1", country: "United States", address: "97 Quarry Rd", city: "Paradise", state: "Pennsylvania", zip: "17562", workPhone: "(717) 913-1677", phone: "(717) 913-1677", email: "isaac@pmcdecor.com", personalEmail: "isaac@pmcdecor.com" },
  { firstName: "Scott", lastName: "Swinehart", jobTitle: "Mechanic", country: "United States", address: "259 Hollow Rd", city: "New Providence", state: "Pennsylvania", zip: "17560", workPhone: "(717) 951-0523", phone: "17179510523", email: "scott@pmcdecor.com", personalEmail: "scott@pmcdecor.com" },
  { firstName: "Shelly", lastName: "Swinehart", jobTitle: "Office Administrator / Estimating Assistant", country: "United States", address: "259 Hollow Rd", city: "New Providence", state: "Pennsylvania", zip: "17560", workPhone: "(717) 288-3227", phone: "(717) 517-1482", email: "shelly@pmcdecor.com", personalEmail: "shelly@pmcdecor.com" },
  { firstName: "Ivan", lastName: "Zavaleta Lopez", jobTitle: "Right Hand Man", country: "United States", address: "252 New St", city: "Coastesville", state: "Pennsylvania", zip: "19320", phone: "(484) 378-5229", email: "ivanlopez0770@icloud.com", personalEmail: "ivanlopez0770@icloud.com" },
  { firstName: "Lee", lastName: "Zook", jobTitle: "Laborer", country: "United States", address: "1733 Jack Russell Run", city: "Paradise", state: "Pennsylvania", zip: "17562", phone: "(223) 266-6280", email: "leezook2008@gmail.com", personalEmail: "leezook2008@gmail.com" },
  { firstName: "Mose", lastName: "Zook", jobTitle: "Trainer", country: "United States", address: "6068 Limeville Rd", city: "Parkesburg", state: "Pennsylvania", phone: "17179131644", email: "mose.zook@pmcdecor.com", personalEmail: "mose.zook@pmcdecor.com" },
];

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

    for (const emp of companyDirectoryData) {
      const fullName = `${emp.firstName} ${emp.lastName}`.toLowerCase();
      const now = new Date().toISOString();
      const existing = existingEmployees.get(fullName);
      
      const employeeData: any = {
        firstName: emp.firstName,
        lastName: emp.lastName,
        email: emp.email || "",
        personalEmail: emp.personalEmail || "",
        phone: formatPhoneNumber(emp.phone || ""),
        workPhone: formatPhoneNumber(emp.workPhone || ""),
        jobTitle: emp.jobTitle,
        address: emp.address || "",
        city: emp.city || "",
        state: emp.state || "",
        zip: emp.zip || "",
        country: emp.country || "United States",
        isActive: true,
        createdAt: existing ? existing.createdAt : now,
        updatedAt: now,
      };

      // Preserve existing data if employee exists (only add defined values)
      if (existing) {
        if (existing.hourlyRate !== undefined) employeeData.hourlyRate = existing.hourlyRate;
        if (existing.vacationHours !== undefined) employeeData.vacationHours = existing.vacationHours;
        if (existing.keypadCode) employeeData.keypadCode = existing.keypadCode;
        if (existing.dateOfBirth) employeeData.dateOfBirth = existing.dateOfBirth;
        if (existing.hireDate) employeeData.hireDate = existing.hireDate;
        if (existing.dateOfLeave) employeeData.dateOfLeave = existing.dateOfLeave;
        if (existing.notes) employeeData.notes = existing.notes;
        if (existing.payHistory && existing.payHistory.length > 0) employeeData.payHistory = existing.payHistory;
        if (existing.apparelRecords && existing.apparelRecords.length > 0) employeeData.apparelRecords = existing.apparelRecords;
      }

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
