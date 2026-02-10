import { Scope, ProjectInfo } from "./index";

export interface DayData {
  dayNumber: number;
  hours: number;
}

export interface WeekData {
  weekNumber: number;
  hours: number;
}

export interface ShortTermDoc {
  jobKey: string;
  customer: string;
  projectNumber: string;
  projectName: string;
  month: string;
  weeks: { weekNumber: number; days: DayData[] }[];
}

export interface LongTermDoc {
  jobKey: string;
  customer: string;
  projectNumber: string;
  projectName: string;
  month: string;
  weeks: WeekData[];
  totalHours?: number;
}

export interface ShortTermJob extends ProjectInfo {
  dates: Date[];
  totalHours: number;
  scopes: Scope[];
}

export interface LongTermJob extends ProjectInfo {
  weekStarts: Date[];
  totalHours: number;
  scopes: Scope[];
}

export interface MonthJob extends ProjectInfo {
  month: string;
  totalHours: number;
  scopes: Scope[];
}
