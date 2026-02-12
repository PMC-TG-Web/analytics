import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

admin.initializeApp();

const db = admin.firestore();

/**
 * Trigger: On any change to a project document.
 * Purpose: Update the global dashboard summary.
 * Note: For a high volume of writes, use distributed counters.
 */
export const aggregateProjectData = functions.firestore
  .document("projects/{projectId}")
  .onWrite(async (change, context) => {
    const before = change.before.exists ? change.before.data() : null;
    const after = change.after.exists ? change.after.data() : null;

    // Use a transaction to ensure atomic updates to the summary document
    const summaryRef = db.collection("metadata").doc("dashboard_summary");

    await db.runTransaction(async (transaction) => {
      const summaryDoc = await transaction.get(summaryRef);
      if (!summaryDoc.exists) return; // Wait for bootstrap to create it

      console.log(`Update triggered for ${context.params.projectId}. Real-time incremental updates are temporarily disabled to ensure data accuracy while the summary methodology is being finalized. Please run the bootstrap script to refresh totals.`);
      return;
/*
      const summary: any = summaryDoc.data();
*/

      // Ensure fields exist
      if (!summary.statusGroups) summary.statusGroups = {};
      if (!summary.contractors) summary.contractors = {};
      if (!summary.pmcGroupHours) summary.pmcGroupHours = {};

      // Helper to update metrics
      const updateMetrics = (projData: any, multiplier: number) => {
        if (!projData) return;
        
        // Apply dashboard exclusion logic
        const projectName = (projData.projectName || "").toString().toLowerCase();
        const customerName = (projData.customer || "").toString().toLowerCase();
        const estimator = (projData.estimator || "").toString().trim().toLowerCase();
        const projectNumber = (projData.projectNumber || "").toString().toLowerCase();

        const isExcluded = 
          projData.projectArchived === true ||
          projData.status === "Invitations" ||
          customerName.includes("sop inc") ||
          ["pmc operations", "pmc shop time", "pmc test project"].includes(projectName) ||
          projectName.includes("sandbox") ||
          projectName.includes("raymond king") ||
          projectName === "alexander drive addition latest" ||
          projectNumber === "701 poplar church rd";

        if (isExcluded) return;

        summary.totalSales = (summary.totalSales || 0) + (Number(projData.sales) || 0) * multiplier;
        summary.totalCost = (summary.totalCost || 0) + (Number(projData.cost) || 0) * multiplier;
        summary.totalHours = (summary.totalHours || 0) + (Number(projData.hours) || 0) * multiplier;

        const status = projData.status || "Unknown";
        if (!summary.statusGroups[status]) {
          summary.statusGroups[status] = { sales: 0, cost: 0, hours: 0, count: 0 };
        }
        summary.statusGroups[status].sales += (Number(projData.sales) || 0) * multiplier;
        summary.statusGroups[status].cost += (Number(projData.cost) || 0) * multiplier;
        summary.statusGroups[status].hours += (Number(projData.hours) || 0) * multiplier;
        summary.statusGroups[status].count += multiplier;

        const customer = projData.customer || "Unknown";
        if (!summary.contractors[customer]) {
          summary.contractors[customer] = { sales: 0, cost: 0, hours: 0, count: 0, byStatus: {} };
        }
        summary.contractors[customer].sales += (Number(projData.sales) || 0) * multiplier;
        summary.contractors[customer].cost += (Number(projData.cost) || 0) * multiplier;
        summary.contractors[customer].hours += (Number(projData.hours) || 0) * multiplier;
        summary.contractors[customer].count += multiplier;
        
        if (!summary.contractors[customer].byStatus) {
          summary.contractors[customer].byStatus = {};
        }
        if (!summary.contractors[customer].byStatus[status]) {
          summary.contractors[customer].byStatus[status] = { sales: 0, cost: 0, hours: 0, count: 0 };
        }
        summary.contractors[customer].byStatus[status].sales += (Number(projData.sales) || 0) * multiplier;
        summary.contractors[customer].byStatus[status].cost += (Number(projData.cost) || 0) * multiplier;
        summary.contractors[customer].byStatus[status].hours += (Number(projData.hours) || 0) * multiplier;
        summary.contractors[customer].byStatus[status].count += multiplier;

        // PMC Group Hours (for the specific labor groups)
        const pmcGroup = (projData.pmcGroup || "").toString().trim();
        if (pmcGroup) {
          const norm = pmcGroup.toLowerCase();
          if (status === "Bid Submitted" || norm.startsWith("pm")) {
            summary.pmcGroupHours[pmcGroup] = (summary.pmcGroupHours[pmcGroup] || 0) + (Number(projData.hours) || 0) * multiplier;
          }

          // Also track specific labor categories for the funnel
          if (status === "Bid Submitted") {
            if (!summary.laborBreakdown) summary.laborBreakdown = {};
            summary.laborBreakdown[pmcGroup] = (summary.laborBreakdown[pmcGroup] || 0) + (Number(projData.hours) || 0) * multiplier;
          }
        }
      };

      // Subtract old data, add new data
      updateMetrics(before, -1);
      updateMetrics(after, 1);

      // Clean up empty contractors to save space
      for (const key in summary.contractors) {
        if (summary.contractors[key].count <= 0) delete summary.contractors[key];
      }

      transaction.set(summaryRef, {
        ...summary,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    return null;
  });
