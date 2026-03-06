import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();

async function seedWIPMatchedHours() {
  try {
    // Read the matched WIP hours JSON file
    const matchedFile = path.join(__dirname, 'matched-wip-2026-03-03T12-11-19-736Z.json');
    const matchedData = JSON.parse(readFileSync(matchedFile, 'utf8'));
    
    console.log(`\n📊 Loading ${matchedData.length} matched WIP hour allocations...\n`);
    
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;
    
    for (const record of matchedData) {
      try {
        // Verify we have a matched project
        if (!record.matchedProjects || record.matchedProjects.length === 0) {
          console.log(`⚠️  Skipping: No matched project for "${record.csvProjectName}" (${record.csvMonth})`);
          skipped++;
          continue;
        }
        
        const project = record.matchedProjects[0];
        const projectId = project.id;
        
        // Find or create Schedule for this project
        let schedule = await prisma.schedule.findFirst({
          where: { projectId }
        });
        
        if (!schedule) {
          schedule = await prisma.schedule.create({
            data: {
              projectId,
              jobKey: `${project.projectNumber}`,
              status: 'In Progress',
              totalHours: project.totalHours || 2000
            }
          });
        }
        
        // Check if allocation for this period already exists
        const existing = await prisma.scheduleAllocation.findFirst({
          where: {
            scheduleId: schedule.id,
            period: record.csvMonth
          }
        });
        
        if (existing) {
          // Update with calculated hours based on percent
          const allocatedHours = (schedule.totalHours * record.csvPercent) / 100;
          
          if (existing.hours !== allocatedHours) {
            await prisma.scheduleAllocation.update({
              where: { id: existing.id },
              data: {
                hours: allocatedHours,
                percent: record.csvPercent
              }
            });
            updated++;
            console.log(`✏️  Updated: ${project.projectName} / ${record.csvMonth} = ${allocatedHours.toFixed(2)}h (${record.csvPercent}%)`);
          } else {
            skipped++;
          }
        } else {
          // Calculate hours from project totalHours and percent
          const allocatedHours = (schedule.totalHours * record.csvPercent) / 100;
          
          // Create new allocation with calculated hours
          await prisma.scheduleAllocation.create({
            data: {
              scheduleId: schedule.id,
              period: record.csvMonth,
              periodType: 'month',
              hours: allocatedHours,
              percent: record.csvPercent
            }
          });
          created++;
          console.log(`✅ Created: ${project.projectName} / ${record.csvMonth} = ${allocatedHours.toFixed(2)}h (${record.csvPercent}%)`);
        }
      } catch (err) {
        errors++;
        console.error(`❌ Error processing "${record.csvProjectName}" (${record.csvMonth}):`, err.message);
      }
    }
    
    // Final stats
    const totalSchedules = await prisma.schedule.count();
    const totalAllocations = await prisma.scheduleAllocation.count();
    const inProgressSchedules = await prisma.schedule.count({
      where: { status: 'In Progress' }
    });
    
    console.log(`\n📈 Results:`);
    console.log(`   ✅ Created: ${created} allocations`);
    console.log(`   ✏️  Updated: ${updated} allocations`);
    console.log(`   ⏭️  Skipped: ${skipped} (unchanged or missing project)`);
    console.log(`   ❌ Errors: ${errors}`);
    console.log(`\n📊 Database State:`);
    console.log(`   Total Schedules: ${totalSchedules}`);
    console.log(`   In Progress: ${inProgressSchedules}`);
    console.log(`   Total Allocations: ${totalAllocations}`);
    
    process.exit(0);
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

seedWIPMatchedHours();
