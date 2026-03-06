
import admin from "firebase-admin";

// Initialize with just the Project ID. 
// This relies on the environment being authenticated (e.g. via firebase login)
if (admin.apps.length === 0) {
  admin.initializeApp({
    projectId: 'pmcdatabasefirebase-sch'
  });
}

const db = admin.firestore();

async function debugWIPGap() {
  try {
    const projectsSnapshot = await db.collection("projects").get();
    const projects = projectsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    const schedulesSnapshot = await db.collection("schedules").get();
    const schedules = schedulesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    console.log("Total Projects:", projects.length);
    console.log("Total Schedules:", schedules.length);

    const totalScheduleHours = schedules.reduce((sum, s) => sum + (s.totalHours || 0), 0);
    console.log("Sum of all schedule totalHours:", totalScheduleHours);

    // Reproduce the filtering logic from the page
    const activeProjects = projects.filter((p) => {
      if (p.projectArchived) return false;
      const status = (p.status || "").toString();
      if (status === "Invitations") return false;
      if (status === "Bid Submitted") return false;
      if (status === "Lost") return false;

      const customer = (p.customer ?? "").toString().toLowerCase();
      if (customer.includes("sop inc")) return false;
      const projectName = (p.projectName ?? "").toString().toLowerCase();
      if (projectName === "pmc operations") return false;
      if (projectName === "pmc shop time") return false;
      if (projectName === "pmc test project") return false;
      if (projectName.includes("sandbox")) return false;
      if (projectName.includes("raymond king")) return false;
      if (projectName === "alexander drive addition latest") return false;
      
      const projectNumber = (p.projectNumber ?? "").toString().toLowerCase();
      if (projectNumber === "701 poplar church rd") return false;
      return true;
    });

    console.log("Active Projects (after exclusions):", activeProjects.length);

    // Deduplicate
    const priorityStatuses = ["Accepted", "In Progress", "Complete"];
    const projectIdentifierMap = new Map();
    activeProjects.forEach((project) => {
      const identifier = (project.projectNumber ?? project.projectName ?? "").toString().trim();
      if (!identifier) return;
      if (!projectIdentifierMap.has(identifier)) projectIdentifierMap.set(identifier, []);
      projectIdentifierMap.get(identifier).push(project);
    });

    const dedupedByCustomer = [];
    projectIdentifierMap.forEach((projectList) => {
      const customerMap = new Map();
      projectList.forEach(p => {
        const customer = (p.customer ?? "").toString().trim();
        if (!customerMap.has(customer)) customerMap.set(customer, []);
        customerMap.get(customer).push(p);
      });
      
      if (customerMap.size > 1) {
        let selectedCustomer = "";
        let foundPriorityCustomer = false;
        customerMap.forEach((projs, customer) => {
          if (projs.some(p => priorityStatuses.includes(p.status || "")) && !foundPriorityCustomer) {
            selectedCustomer = customer;
            foundPriorityCustomer = true;
          }
        });
        if (!foundPriorityCustomer) {
            selectedCustomer = Array.from(customerMap.keys())[0];
        }
        dedupedByCustomer.push(...(customerMap.get(selectedCustomer) || []));
      } else {
        projectList.forEach(p => dedupedByCustomer.push(p));
      }
    });

    console.log("Deduped Projects:", dedupedByCustomer.length);

    const qualifyingJobKeys = new Set(dedupedByCustomer.map(p => 
      p.jobKey || `${p.customer || ''}~${p.projectNumber || ''}~${p.projectName || ''}`
    ));

    let poolSum = 0;
    qualifyingJobKeys.forEach(jobKey => {
        const jobProjects = projects.filter(p => (p.jobKey || `${p.customer || ''}~${p.projectNumber || ''}~${p.projectName || ''}`) === jobKey);
        const schedule = schedules.find(s => s.jobKey === jobKey);
        let budget = 0;
        if (schedule && schedule.totalHours > 0) budget = schedule.totalHours;
        else budget = jobProjects.reduce((sum, p) => sum + (p.hours || 0), 0);
        poolSum += budget;
    });

    console.log("Current Derived Pool Sum:", poolSum);

    // Find schedules NOT in qualifyingJobKeys
    const missingSchedules = schedules.filter(s => !qualifyingJobKeys.has(s.jobKey));
    console.log("Schedules NOT in qualifyingJobKeys:", missingSchedules.length);
    
    const missingHours = missingSchedules.reduce((sum, s) => sum + (s.totalHours || 0), 0);
    console.log("Hours in missing schedules:", missingHours);

    missingSchedules.forEach(s => {
        console.log(`Missing: ${s.jobKey} - ${s.totalHours} hrs - Status: ${s.status}`);
    });

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

debugWIPGap();
