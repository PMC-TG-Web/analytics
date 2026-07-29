const PROCORE_TIME_ZONE = "America/New_York";

const procoreDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: PROCORE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function formatProcoreDate(date: Date): string {
  const parts = procoreDateFormatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    throw new Error("Unable to format the Procore date window.");
  }
  return `${year}-${month}-${day}`;
}

export function procoreLookbackWindow(now: Date, lookbackDays: number) {
  const safeLookbackDays = Math.max(0, Math.trunc(lookbackDays));
  return {
    startDate: formatProcoreDate(new Date(now.getTime() - safeLookbackDays * 86_400_000)),
    endDate: formatProcoreDate(now),
  };
}
