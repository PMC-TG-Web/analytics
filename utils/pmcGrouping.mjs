/**
 * PMC Grouping Utility Module
 * 
 * Responsibilities:
 * - Load PMC group mappings from database
 * - Map Costitems to PMC groups using database lookups
 * - Aggregate hours into both granular (by Costitem) and grouped (by PMC) breakdowns
 * - Support dual-storage strategy for maximum analytics flexibility
 * 
 * Data Structures:
 * - pmcBreakdown: { "Slab On Grade Labor": 250.5, "Site Concrete Labor": 185.3, ... }
 * - pmcGroupBreakdown: { "Foundation Labor": 435.8, "Equipment": 120.0, ... }
 */

import { PrismaClient } from '@prisma/client';

// ==================== DATABASE CONNECTION ====================

const prisma = new PrismaClient();
let costitemToPMCCache = null;
let pmcGroupsCache = null;

// ==================== DATABASE LOADING ====================

/**
 * Load all PMC groups and mappings from database into memory cache
 * @returns {Promise<void>}
 */
async function loadPMCMappingsFromDB() {
  if (costitemToPMCCache && pmcGroupsCache) {
    return; // Already loaded
  }

  try {
    // Load all PMC groups
    const groups = await prisma.pMCGroup.findMany({
      orderBy: { displayOrder: 'asc' }
    });
    
    pmcGroupsCache = groups.reduce((acc, group) => {
      acc[group.id] = group;
      return acc;
    }, {});

    // Load all cost item mappings
    const mappings = await prisma.costitemPMCMapping.findMany({
      include: {
        pmcGroup: true
      }
    });

    costitemToPMCCache = {};
    for (const mapping of mappings) {
      costitemToPMCCache[mapping.costitem] = mapping.pmcGroup.name;
    }

    console.log(`Loaded ${Object.keys(pmcGroupsCache).length} PMC groups and ${Object.keys(costitemToPMCCache).length} cost item mappings`);
  } catch (error) {
    console.error('Failed to load PMC mappings from database:', error.message);
    // Initialize empty caches as fallback
    costitemToPMCCache = {};
    pmcGroupsCache = {};
  }
}

/**
 * Get all PMC groups
 * @returns {Promise<Array>} Array of PMC group objects
 */
export async function getAllPMCGroups() {
  await loadPMCMappingsFromDB();
  return Object.values(pmcGroupsCache);
}

// ==================== COSTITEM MAPPING ====================

/**
 * Map a single Costitem to its PMC group name
 * Uses database lookups with caching for performance
 * 
 * @param {string} costitem - The Costitem string to categorize
 * @returns {Promise<string>} PMC group name (e.g., "Foundation Labor", "Equipment")
 */
export async function mapCostitemToPMC(costitem) {
  if (!costitem) return 'Uncategorized';
  
  // Load mappings if not already done
  await loadPMCMappingsFromDB();
  
  // Return cached result or default
  return costitemToPMCCache[costitem] || 'Uncategorized';
}

/**
 * Clear the Costitem-PMC mapping cache
 * Useful after configuration updates or seed operations
 */
export function clearMappingCache() {
  costitemToPMCCache = null;
}

// ==================== PMC BREAKDOWN AGGREGATION ====================

/**
 * Aggregate hours from line items into PMC breakdowns
 * 
 * Creates two complementary breakdowns:
 * 1. Granular: { "Costitem Name": hours, ... } - all 1,902+ items
 * 2. Grouped: { "PMC Group Name": hours, ... } - aggregated into PMC groups
 * 
 * @param {Array} lineItems - Array of line items with { Costitems, hours }
 * @returns {Promise<Object>} { pmcBreakdown, pmcGroupBreakdown, totalHours }
 */
export async function aggregatePMCBreakdowns(lineItems) {
  const pmcBreakdown = {};
  const pmcGroupBreakdown = {};
  let totalHours = 0;
  
  if (!lineItems || !Array.isArray(lineItems)) {
    return { pmcBreakdown, pmcGroupBreakdown, totalHours: 0 };
  }
  
  // Load mappings first
  await loadPMCMappingsFromDB();
  
  // Aggregate line items
  for (const item of lineItems) {
    const costitem = item.Costitems || 'Unknown';
    const hours = parseFloat(item.hours) || 0;
    
    // Skip zero-hour items
    if (hours === 0) continue;
    
    // Granular breakdown: accumulate by Costitem
    if (!pmcBreakdown[costitem]) {
      pmcBreakdown[costitem] = 0;
    }
    pmcBreakdown[costitem] += hours;
    
    // Grouped breakdown: map Costitem to PMC group name, then accumulate
    const pmcGroupName = await mapCostitemToPMC(costitem);
    if (!pmcGroupBreakdown[pmcGroupName]) {
      pmcGroupBreakdown[pmcGroupName] = 0;
    }
    pmcGroupBreakdown[pmcGroupName] += hours;
    
    totalHours += hours;
  }
  
  // Sort both breakdowns for consistency and readability
  const sortedPMCBreakdown = Object.keys(pmcBreakdown)
    .sort()
    .reduce((acc, key) => {
      acc[key] = Math.round(pmcBreakdown[key] * 100) / 100; // 2 decimal places
      return acc;
    }, {});
  
  const sortedPMCGroupBreakdown = Object.keys(pmcGroupBreakdown)
    .sort()
    .reduce((acc, key) => {
      acc[key] = Math.round(pmcGroupBreakdown[key] * 100) / 100;
      return acc;
    }, {});
  
  return {
    pmcBreakdown: sortedPMCBreakdown,
    pmcGroupBreakdown: sortedPMCGroupBreakdown,
    totalHours: Math.round(totalHours * 100) / 100
  };
}

/**
 * Merge multiple PMC breakdowns (useful for combining multiple projects/phases)
 * 
 * @param {Array<Object>} breakdowns - Array of breakdown objects { pmcBreakdown, pmcGroupBreakdown }
 * @returns {Object} Merged breakdowns with summed hours
 */
export function mergePMCBreakdowns(breakdowns) {
  const mergedGranular = {};
  const mergedGrouped = {};
  let totalHours = 0;
  
  for (const breakdown of breakdowns) {
    if (breakdown.pmcBreakdown) {
      for (const [costitem, hours] of Object.entries(breakdown.pmcBreakdown)) {
        mergedGranular[costitem] = (mergedGranular[costitem] || 0) + hours;
      }
    }
    if (breakdown.pmcGroupBreakdown) {
      for (const [code, hours] of Object.entries(breakdown.pmcGroupBreakdown)) {
        mergedGrouped[code] = (mergedGrouped[code] || 0) + hours;
      }
    }
  }
  
  return {
    pmcBreakdown: mergedGranular,
    pmcGroupBreakdown: mergedGrouped,
    totalHours: Object.values(mergedGrouped).reduce((a, b) => a + b, 0)
  };
}

/**
 * Get percentage breakdown by PMC group
 * Useful for reporting and analytics
 * 
 * @param {Object} pmcGroupBreakdown - { "CODE": hours, ... }
 * @returns {Object} { "CODE": { hours, percentage }, ... }
 */
export function getPMCGroupPercentages(pmcGroupBreakdown) {
  const total = Object.values(pmcGroupBreakdown).reduce((a, b) => a + b, 0);
  
  const result = {};
  for (const [code, hours] of Object.entries(pmcGroupBreakdown)) {
    result[code] = {
      hours: Math.round(hours * 100) / 100,
      percentage: total > 0 ? Math.round((hours / total) * 10000) / 100 : 0
    };
  }
  
  return result;
}

// ==================== DIAGNOSTICS ====================

/**
 * Analyze Costitems to PMC mapping distribution
 * Returns statistics about how Costitems are being categorized
 * 
 * @param {Array<Object>} allCostitems - All unique Costitems with hours
 * @returns {Object} Distribution statistics
 */
export function analyzeMappingDistribution(allCostitems) {
  const distribution = {};
  
  for (const item of allCostitems) {
    const pmcCode = mapCostitemToPMC(item.costitem);
    if (!distribution[pmcCode]) {
      distribution[pmcCode] = { count: 0, items: [] };
    }
    distribution[pmcCode].count += 1;
    distribution[pmcCode].items.push(item.costitem);
  }
  
  return distribution;
}

/**
 * Validate PMC configuration and report issues
 * @returns {Array} Array of validation warnings/errors
 */
export function validatePMCConfig() {
  const config = loadPMCConfig();
  const issues = [];
  
  // Check for duplicate group codes
  const codes = new Set();
  for (const group of config.pmcGroups) {
    if (codes.has(group.code)) {
      issues.push(`Duplicate PMC code: ${group.code}`);
    }
    codes.add(group.code);
  }
  
  // Check for rules referencing non-existent groups
  const validCodes = new Set(codes);
  for (const rule of config.mappingStrategy.rules || []) {
    if (!validCodes.has(rule.pmcCode)) {
      issues.push(`Rule references non-existent PMC code: ${rule.pmcCode}`);
    }
  }
  
  return issues;
}

/**
 * Export current mapping cache to CSV for manual review/cleanup
 * @param {string} [outputPath] - Path to write CSV file
 * @returns {string} CSV content or file path if written
 */
export function exportMappingCache(outputPath = null) {
  const config = loadPMCConfig();
  const codeMap = new Map(config.pmcGroups.map(g => [g.code, g.name]));
  
  // Build CSV header
  const rows = [['Costitem', 'PMC Code', 'PMC Name']];
  
  // Get all cached mappings
  if (!costitemToPMCCache) {
    return 'No mappings cached yet. Run aggregations first.';
  }
  
  for (const [costitem, pmcCode] of Object.entries(costitemToPMCCache)) {
    rows.push([costitem, pmcCode, codeMap.get(pmcCode) || 'Unknown']);
  }
  
  // Convert to CSV format
  const csv = rows
    .map(row => row.map(col => `"${(col || '').toString().replace(/"/g, '""')}"`).join(','))
    .join('\n');
  
  if (outputPath) {
    fs.writeFileSync(outputPath, csv);
    return outputPath;
  }
  
  return csv;
}
