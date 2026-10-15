export type ProjectScope = { name: string; description: string; proposedUse: string; planType?: string };
export type ProjectFocus = { included: boolean; category: string; reason: string };

// A browsing aid, not a publisher classification or proof of masonry scope.
export function marketProjectFocus(project: ProjectScope): ProjectFocus {
  const description = project.description.toLowerCase();
  const title = project.name.toLowerCase();
  const text = title + ' ' + description;
  const use = project.proposedUse.toLowerCase();
  const buildingWork = /\b(?:construct\w*|expand\w*|renovat\w*|redevelop\w*)\b.{0,90}\b(?:new |an? |the |existing )?(?:apartment buildings?|office buildings?|warehouse|hotel|store|school building|church|hangar|flour mill|building addition|addition to the.{0,25}building)\b/.test(description)
    || /\b(?:construct\w*|expand\w*|renovat\w*)\b.{0,45}\b(?:building|facility)\b/.test(description)
    || /\bbuilding (?:expansion|addition)\b/.test(description);
  const siteOnly = /stormwater management plan/i.test(project.planType ?? '')
    || /\b(?:road relocation|parking expansion|parking lot addition|turf fields?|golf course improvements|water.{0,5}sewer improvements|campus grading|lot.line|annexation)\b/.test(text)
    || /\b(?:subdivide|trading|consolidat\w*)\b/.test(description);
  // Site work can mention an existing building without proposing building work.
  const explicitSiteOnly = /^(?:construction of an addition to the parking lot|construction of a [\d,]+.space parking lot|improvements to the existing stormwater|installation of water and sewer|hill road relocation)/.test(description);
  if (explicitSiteOnly || (siteOnly && !buildingWork && !/\b(?:apartment buildings?|mixed.use buildings?)\b/.test(description))) return { included: false, category: 'Site work / land only', reason: 'No clear building scope in this submission' };
  if (/\b(?:apartments?|multi[ -]?family|condominiums?)\b/.test(text) || /\bmixed.use buildings?\b/.test(text) && /\bresidential\b/.test(text)) return { included: true, category: 'Multifamily / mixed use', reason: 'Apartment, multifamily or mixed-use building scope' };
  if (/\b(?:single.family|single family|townhomes?|townhouses?|residential garage)\b/.test(text) && !/commercial|industrial|institutional/.test(use) && !/\b(?:business|warehouse|store|office)\b/.test(description)) return { included: false, category: 'Other residential', reason: 'No explicit apartment or multifamily building scope' };
  if (/\b(?:warehouse|distribution cent(?:er|re)|manufactur\w*|factory|flour mill|hangar|industrial building)\b/.test(text) || /industrial/.test(use)) return { included: true, category: 'Industrial / warehouse', reason: 'Industrial use or building description' };
  if (/\b(?:stores?|retail|shopping|hotel|restaurant|dealership|food market|car wash|coffee shop|jewelers|supply)\b/.test(text)) return { included: true, category: 'Retail / hospitality', reason: 'Retail, hospitality or business premises described' };
  if (/institutional|community services/.test(use) || /\b(?:hospital|health|medical|school|college|church|veterinary|dental)\b/.test(text)) return { included: true, category: 'Healthcare / institutional', reason: 'Institutional use or building description' };
  if (/commercial/.test(use) || /\b(?:office building|business building|woodcraft business)\b/.test(text)) return { included: true, category: 'Commercial / office', reason: 'Commercial use or business building description' };
  return { included: false, category: 'Other / review scope', reason: 'Published details do not establish a target building type' };
}
