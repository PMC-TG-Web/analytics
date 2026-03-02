/**
 * Project Deduplication Logic
 * 
 * When multiple customers bid on the same project (same projectName),
 * this logic determines which customer's entry to keep.
 * 
 * Priority Order:
 * 1. Status: Prefer "Accepted" or "In Progress" status
 * 2. dateUpdated: Use the most recently updated entry
 * 3. dateCreated: If dateUpdated is missing/tied, fall back to most recently created
 * 4. Customer Name: If all else is tied, sort alphabetically and pick first
 */

/**
 * Selects the best project entry when multiple customers have the same projectName
 * @param {Array} projectList - Array of projects with same projectName but different customers
 * @returns {Object} The selected project entry
 */
export function selectBestProjectEntry(projectList) {
  if (!projectList || projectList.length === 0) {
    return null;
  }

  if (projectList.length === 1) {
    return projectList[0];
  }

  // Step 1: Filter by preferred status (Accepted or In Progress)
  let candidates = projectList.filter(
    p => p.status === 'Accepted' || p.status === 'In Progress'
  );

  // If no Accepted/In Progress found, use all candidates
  if (candidates.length === 0) {
    candidates = projectList;
  }

  // Step 2: Sort by dateUpdated (latest first), fallback to dateCreated, then customer alphabetically
  candidates.sort((a, b) => {
    // Priority 1: dateUpdated (latest first)
    const dateUpdatedA = a.dateUpdated ? new Date(a.dateUpdated) : null;
    const dateUpdatedB = b.dateUpdated ? new Date(b.dateUpdated) : null;

    // If both have dateUpdated, compare them
    if (dateUpdatedA && dateUpdatedB) {
      if (dateUpdatedB.getTime() !== dateUpdatedA.getTime()) {
        return dateUpdatedB.getTime() - dateUpdatedA.getTime();
      }
    } else if (dateUpdatedA && !dateUpdatedB) {
      // A has dateUpdated, B doesn't - A wins
      return -1;
    } else if (!dateUpdatedA && dateUpdatedB) {
      // B has dateUpdated, A doesn't - B wins
      return 1;
    }
    // Both missing dateUpdated or tied - continue to next priority

    // Priority 2: dateCreated (latest first) - fallback when dateUpdated is missing or tied
    const dateCreatedA = a.dateCreated ? new Date(a.dateCreated) : new Date(0);
    const dateCreatedB = b.dateCreated ? new Date(b.dateCreated) : new Date(0);

    if (dateCreatedB.getTime() !== dateCreatedA.getTime()) {
      return dateCreatedB.getTime() - dateCreatedA.getTime();
    }
    // Still tied - continue to next priority

    // Priority 3: Customer alphabetically
    const customerA = a.customer || '';
    const customerB = b.customer || '';
    return customerA.localeCompare(customerB);
  });

  return candidates[0];
}

/**
 * Deduplicates an array of projects by projectName
 * @param {Array} projects - Array of all project entries
 * @returns {Object} Object with deduplicatedProjects array and statistics
 */
export function deduplicateProjects(projects) {
  // Group projects by projectName
  const projectGroups = {};

  projects.forEach(proj => {
    const name = proj.projectName;
    if (!name) return;

    if (!projectGroups[name]) {
      projectGroups[name] = [];
    }
    projectGroups[name].push(proj);
  });

  // Deduplicate and collect statistics
  const deduplicatedProjects = [];
  let duplicatesRemoved = 0;

  Object.entries(projectGroups).forEach(([name, projectList]) => {
    const selected = selectBestProjectEntry(projectList);
    deduplicatedProjects.push(selected);

    if (projectList.length > 1) {
      duplicatesRemoved += projectList.length - 1;
    }
  });

  return {
    deduplicatedProjects,
    originalCount: projects.length,
    deduplicatedCount: deduplicatedProjects.length,
    duplicatesRemoved,
  };
}

export default { selectBestProjectEntry, deduplicateProjects };
