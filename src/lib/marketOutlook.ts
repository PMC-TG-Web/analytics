export type MarketSignal = "strong" | "mixed" | "weak" | "watch";

export type MarketIndicator = {
  name: string;
  group: "Pipeline" | "Current market" | "Material costs" | "Labor" | "Financing";
  value: string;
  change?: string;
  signal: MarketSignal;
  leadTime: string;
  why: string;
  geography: string;
  period: string;
  source: string;
  sourceUrl: string;
  note: string;
};

export const MARKET_OUTLOOK_UPDATED_AT = "September 8, 2026";

export const marketIndicators: MarketIndicator[] = [
  {
    name: "Architecture Billings Index (ABI)", group: "Pipeline", value: "46.6", change: "Down from 47.3",
    signal: "weak", leadTime: "9–12 months", why: "Future nonresidential construction", geography: "U.S. / Northeast",
    period: "July 2026", source: "AIA", sourceUrl: "https://www.aia.org/resource-center/abi-july-2026-architecture-firm-billings-remain-weak",
    note: "Below 50 means more architecture firms reported declining billings. The Northeast was the weakest region.",
  },
  {
    name: "Architecture inquiries", group: "Pipeline", value: "Growing", change: "Growth slowed",
    signal: "mixed", leadTime: "9–15 months", why: "Projects entering the design pipeline", geography: "U.S. / Northeast",
    period: "July 2026", source: "AIA", sourceUrl: "https://www.aia.org/resource-center/abi-july-2026-architecture-firm-billings-remain-weak",
    note: "Potential clients are still exploring projects, but inquiries are not yet consistently converting to contracts.",
  },
  {
    name: "New design contracts", group: "Pipeline", value: "Declining", change: "Weaker in July",
    signal: "weak", leadTime: "8–12 months", why: "Projects making a financial commitment", geography: "U.S. / Northeast",
    period: "July 2026", source: "AIA", sourceUrl: "https://www.aia.org/resource-center/abi-july-2026-architecture-firm-billings-remain-weak",
    note: "Signed design contracts weakened even while inquiries increased, showing a conversion gap.",
  },
  {
    name: "Dodge Momentum Index", group: "Pipeline", value: "291.7", change: "+6.9% month over month",
    signal: "strong", leadTime: "12+ months", why: "Nonresidential projects entering planning", geography: "U.S.",
    period: "July 2026", source: "Dodge", sourceUrl: "https://www.construction.com/dodge-momentum-index-improves-7-in-july/",
    note: "Commercial planning rose 4.1%; institutional planning rose 13.1%. Data centers remain a large driver.",
  },
  {
    name: "Construction starts", group: "Current market", value: "Mixed", change: "Sector dependent",
    signal: "mixed", leadTime: "0–6 months", why: "Projects moving from planning into construction", geography: "U.S. / PA priority",
    period: "Latest release", source: "Dodge / Census", sourceUrl: "https://www.census.gov/construction/",
    note: "Track Pennsylvania and local nonresidential permits and starts as geographic releases become available.",
  },
  {
    name: "Construction spending", group: "Current market", value: "$2.167T", change: "−3.2% year over year",
    signal: "mixed", leadTime: "Current", why: "Overall market direction", geography: "U.S.",
    period: "June 2026", source: "Census", sourceUrl: "https://www.census.gov/construction/c30/current/index.html",
    note: "Total spending slipped 0.1% month over month. Private nonresidential spending was nearly flat at $745.3B.",
  },
  {
    name: "Ready-mix concrete PPI", group: "Material costs", value: "Price watch", change: "Monthly trend",
    signal: "watch", leadTime: "Immediate", why: "Concrete material pricing", geography: "U.S. producer prices",
    period: "July 2026", source: "BLS", sourceUrl: "https://www.bls.gov/ppi/",
    note: "Use the detailed commodity series to separate ready-mix pressure from broad construction inflation.",
  },
  {
    name: "Cement PPI", group: "Material costs", value: "Price watch", change: "Monthly trend",
    signal: "watch", leadTime: "Current / trend", why: "Leading pressure on concrete prices", geography: "U.S. producer prices",
    period: "July 2026", source: "BLS", sourceUrl: "https://www.bls.gov/ppi/",
    note: "Cement movement can precede changes in delivered concrete pricing.",
  },
  {
    name: "Steel and rebar PPI", group: "Material costs", value: "Price watch", change: "Monthly trend",
    signal: "watch", leadTime: "Current / trend", why: "Reinforcing cost pressure", geography: "U.S. producer prices",
    period: "July 2026", source: "BLS", sourceUrl: "https://www.bls.gov/ppi/",
    note: "Monitor fabricated and mill-product series alongside supplier quotes.",
  },
  {
    name: "Diesel prices", group: "Material costs", value: "Weekly watch", change: "Delivery-sensitive",
    signal: "watch", leadTime: "Immediate", why: "Delivery and equipment costs", geography: "Central Atlantic / PA priority",
    period: "Weekly", source: "EIA", sourceUrl: "https://www.eia.gov/petroleum/gasdiesel/",
    note: "The Central Atlantic series is the closest consistent public benchmark for Paradise's operating area.",
  },
  {
    name: "Construction employment", group: "Labor", value: "+22K", change: "Month over month",
    signal: "strong", leadTime: "0–6 months", why: "Labor demand", geography: "U.S. / PA metros priority",
    period: "July 2026", source: "BLS", sourceUrl: "https://www.bls.gov/news.release/archives/empsit_08072026.htm",
    note: "National construction payrolls increased; local metro employment should drive the hiring-pressure view.",
  },
  {
    name: "Construction unemployment", group: "Labor", value: "Local watch", change: "Monthly",
    signal: "watch", leadTime: "0–6 months", why: "Labor availability", geography: "Pennsylvania priority",
    period: "Latest state release", source: "BLS / ABC", sourceUrl: "https://www.bls.gov/lau/",
    note: "Lower unemployment means a tighter field-labor pool. Pennsylvania and nearby metro data should lead this card.",
  },
  {
    name: "Average construction wages", group: "Labor", value: "$1,637.67", change: "Average weekly earnings",
    signal: "watch", leadTime: "0–6 months", why: "Labor cost pressure", geography: "U.S. / PA metros priority",
    period: "July 2026", source: "BLS", sourceUrl: "https://www.bls.gov/charts/employment-situation/employment-and-average-weekly-earnings-by-industry-bubble.htm",
    note: "Pair the national benchmark with Pennsylvania and local wage growth when metro releases are available.",
  },
  {
    name: "Building permits", group: "Pipeline", value: "Local priority", change: "Monthly",
    signal: "watch", leadTime: "3–9 months", why: "Local project pipeline", geography: "Lancaster / Harrisburg / Reading / York",
    period: "Latest local release", source: "Census / local", sourceUrl: "https://www.census.gov/construction/bps/",
    note: "Local permits are more useful than the national total for estimating Paradise's addressable pipeline.",
  },
  {
    name: "Interest rates", group: "Financing", value: "Restrictive", change: "Developer pressure",
    signal: "weak", leadTime: "3–12 months", why: "Cost and availability of project financing", geography: "U.S.",
    period: "Current policy", source: "Federal Reserve", sourceUrl: "https://www.federalreserve.gov/monetarypolicy/openmarket.htm",
    note: "Higher financing costs can delay privately funded commercial work even when planning activity is high.",
  },
  {
    name: "Commercial lending conditions", group: "Financing", value: "Tight", change: "Quarterly survey",
    signal: "weak", leadTime: "3–12 months", why: "Whether developers can fund projects", geography: "U.S.",
    period: "July 2026 survey", source: "Federal Reserve", sourceUrl: "https://www.federalreserve.gov/datadownload/Choose.aspx?rel=SLOOS",
    note: "Track standards and demand for commercial real-estate and business loans, not rates alone.",
  },
  {
    name: "Contractor backlog", group: "Current market", value: "8.8 months", change: "Stable but uneven",
    signal: "mixed", leadTime: "3–9 months", why: "Contractor workload already under contract", geography: "U.S. / Northeast",
    period: "July 2026", source: "ABC", sourceUrl: "https://www.abc.org/News-Media/News-Releases/abc-construction-backlog-indicator-rises-contractor-optimism-slips-in-july",
    note: "Regional and sector detail matters: data-center contractors carry materially more backlog than others.",
  },
  {
    name: "Contractor Confidence Index", group: "Current market", value: "Above 50", change: "Growth expected",
    signal: "strong", leadTime: "3–6 months", why: "Sales, staffing and profit expectations", geography: "U.S. / Northeast",
    period: "July 2026", source: "ABC", sourceUrl: "https://www.abc.org/News-Media/News-Releases/abc-construction-backlog-indicator-rises-contractor-optimism-slips-in-july",
    note: "Sales, staffing and profit-margin readings remained above the growth threshold, despite softer optimism.",
  },
];

export const sectorOutlook = [
  { name: "Institutional", value2026: "+2.8%", value2027: "+2.7%", signal: "strong" as const, note: "Healthcare is among the stronger opportunity areas." },
  { name: "Overall nonresidential", value2026: "−0.3%", value2027: "+3.0%", signal: "mixed" as const, note: "A modest 2026 contraction followed by a projected recovery." },
  { name: "Manufacturing", value2026: "−11.6%", value2027: "—", signal: "weak" as const, note: "A sharp pullback makes this a selective pursuit market." },
];
