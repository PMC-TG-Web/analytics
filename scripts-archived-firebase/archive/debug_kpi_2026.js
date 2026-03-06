const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, query, where } = require('firebase/firestore');
const fs = require('fs');

const config = JSON.parse(fs.readFileSync('src/firebaseConfig.json', 'utf8'));
const app = initializeApp(config);
const db = getFirestore(app);

function parseDateValue(dateVal) {
    if (!dateVal) return null;
    if (dateVal instanceof Date) return dateVal;
    if (typeof dateVal === 'string') {
        const d = new Date(dateVal);
        return isNaN(d.getTime()) ? null : d;
    }
    if (dateVal.toDate && typeof dateVal.toDate === 'function') {
        return dateVal.toDate();
    }
    return null;
}

function getProjectDate(project) {
    const created = parseDateValue(project.dateCreated);
    const updated = parseDateValue(project.dateUpdated);
    if (created) return created;
    return updated || null;
}

async function debug() {
    console.log("Fetching all projects...");
    const snapshot = await getDocs(collection(db, 'projects'));
    const projects = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    console.log(`Total projects: ${projects.length}`);

    const projectIdentifierMap = new Map();
    projects.forEach((project) => {
        const identifier = (project.projectNumber || project.projectName || "").toString().trim();
        if (!identifier) return;

        if (!projectIdentifierMap.has(identifier)) {
            projectIdentifierMap.set(identifier, []);
        }
        projectIdentifierMap.get(identifier).push(project);
    });

    const dedupedByCustomer = [];
    projectIdentifierMap.forEach((projectList, identifier) => {
        const customerMap = new Map();
        projectList.forEach(p => {
            const customer = (p.customer ?? "").toString().trim();
            if (!customerMap.has(customer)) {
                customerMap.set(customer, []);
            }
            customerMap.get(customer).push(p);
        });

        if (customerMap.size > 1) {
            const priorityStatuses = ["Accepted", "In Progress", "Complete"];
            let selectedCustomer = "";
            let selectedProjects = [];

            let foundPriorityCustomer = false;
            customerMap.forEach((projs, customer) => {
                const hasPriorityStatus = projs.some(p => priorityStatuses.includes(p.status || ""));
                if (hasPriorityStatus && !foundPriorityCustomer) {
                    selectedCustomer = customer;
                    selectedProjects = projs;
                    foundPriorityCustomer = true;
                }
            });

            if (!foundPriorityCustomer) {
                let latestCustomer = "";
                let latestDate = null;

                customerMap.forEach((projs, customer) => {
                    const mostRecentProj = projs.reduce((latest, current) => {
                        const currentDate = getProjectDate(current);
                        const latestDateVal = getProjectDate(latest);
                        if (!currentDate) return latest;
                        if (!latestDateVal) return current;
                        return currentDate > latestDateVal ? current : latest;
                    }, projs[0]);

                    const projDate = getProjectDate(mostRecentProj);
                    if (projDate && (!latestDate || projDate > latestDate)) {
                        latestDate = projDate;
                        latestCustomer = customer;
                    }
                });

                selectedCustomer = latestCustomer;
                selectedProjects = customerMap.get(latestCustomer) || [];
            }

            dedupedByCustomer.push(...selectedProjects);
        } else {
            projectList.forEach(p => dedupedByCustomer.push(p));
        }
    });

    console.log(`Deduped items: ${dedupedByCustomer.length}`);

    const bidSubmittedSalesByMonth = {};
    let count2026 = 0;
    let total2026 = 0;

    dedupedByCustomer.forEach((project) => {
        const status = (project.status || "").trim();
        if (status !== "Bid Submitted" && status !== "Estimating") return;
        
        const projectDate = getProjectDate(project);
        if (!projectDate) return;
        
        const monthKey = `${projectDate.getFullYear()}-${String(projectDate.getMonth() + 1).padStart(2, "0")}`;
        const sales = Number(project.sales ?? 0);
        
        if (monthKey.startsWith("2026")) {
            count2026++;
            total2026 += sales;
        }

        bidSubmittedSalesByMonth[monthKey] = (bidSubmittedSalesByMonth[monthKey] || 0) + sales;
    });

    console.log("Monthly Bid Submitted Sales:");
    Object.keys(bidSubmittedSalesByMonth).sort().forEach(k => {
        console.log(`${k}: $${bidSubmittedSalesByMonth[k].toLocaleString()}`);
    });

    console.log(`\n2026 Summary: Count=${count2026}, Total=$${total2026.toLocaleString()}`);

    // Specifically check GLC Lehigh Valley
    const glc = dedupedByCustomer.filter(p => p.projectName === "GLC Lehigh Valley Warehouse");
    if (glc.length > 0) {
        console.log(`\nGLC Lehigh Valley Warehouse found in deduped list!`);
        console.log(`Customer: ${glc[0].customer}`);
        const totalSales = glc.reduce((sum, p) => sum + (p.sales || 0), 0);
        console.log(`Total Sales for this project: $${totalSales.toLocaleString()}`);
        console.log(`Date: ${getProjectDate(glc[0])}`);
    } else {
        console.log("\nGLC Lehigh Valley Warehouse NOT found in deduped list.");
    }

    process.exit(0);
}

debug().catch(console.error);
