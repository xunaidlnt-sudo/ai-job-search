// Words and defaults for each interface mode. The data and engine are the
// same; only what people read changes, so a P6 planner sees "Activity ID" and
// "Total Float" while an MS Project user sees "ID" and "Total Slack".

import type { InterfaceMode } from "../core/reporting";
import { useConfig } from "../backend/config";

export interface Terms {
  modeName: string;
  activity: string;
  activities: string;
  activityId: string;
  activityName: string;
  wbs: string;
  dataDate: string;
  totalFloat: string;
  freeFloat: string;
  originalDuration: string;
  remainingDuration: string;
  percentComplete: string;
  predecessors: string;
  successors: string;
  relationship: string;
  baseline: string;
  schedule: string;
  resources: string;
  constraint: string;
  milestone: string;
  project: string;
  projects: string;
  playbackDate: string;
  /** How durations are shown in tables. */
  durationUnit: "d" | " days" | "d ";
}

const P6: Terms = {
  modeName: "P6 style",
  activity: "Activity",
  activities: "Activities",
  activityId: "Activity ID",
  activityName: "Activity Name",
  wbs: "WBS",
  dataDate: "Data Date",
  totalFloat: "Total Float",
  freeFloat: "Free Float",
  originalDuration: "Original Duration",
  remainingDuration: "Remaining Duration",
  percentComplete: "Physical % Complete",
  predecessors: "Predecessors",
  successors: "Successors",
  relationship: "Relationship",
  baseline: "Baseline",
  schedule: "Schedule",
  resources: "Resources",
  constraint: "Primary Constraint",
  milestone: "Milestone",
  project: "Project",
  projects: "Projects",
  playbackDate: "Timescale date",
  durationUnit: "d",
};

const MSP: Terms = {
  modeName: "MS Project style",
  activity: "Task",
  activities: "Tasks",
  activityId: "ID",
  activityName: "Task Name",
  wbs: "Outline",
  dataDate: "Status Date",
  totalFloat: "Total Slack",
  freeFloat: "Free Slack",
  originalDuration: "Duration",
  remainingDuration: "Remaining Duration",
  percentComplete: "% Complete",
  predecessors: "Predecessors",
  successors: "Successors",
  relationship: "Link",
  baseline: "Baseline",
  schedule: "Calculate",
  resources: "Resource Names",
  constraint: "Constraint Type",
  milestone: "Milestone",
  project: "Project",
  projects: "Projects",
  playbackDate: "Date",
  durationUnit: " days",
};

const FOURD: Terms = {
  modeName: "4D style",
  activity: "Task",
  activities: "Tasks",
  activityId: "Task ID",
  activityName: "Task Name",
  wbs: "WBS",
  dataDate: "Data Date",
  totalFloat: "Total Float",
  freeFloat: "Free Float",
  originalDuration: "Planned Duration",
  remainingDuration: "Remaining Duration",
  percentComplete: "% Complete",
  predecessors: "Predecessors",
  successors: "Successors",
  relationship: "Dependency",
  baseline: "Baseline",
  schedule: "Reschedule",
  resources: "Resources",
  constraint: "Constraint",
  milestone: "Milestone",
  project: "Project",
  projects: "Projects",
  playbackDate: "Focus date",
  durationUnit: "d",
};

export const TERMS: Record<InterfaceMode, Terms> = { p6: P6, msp: MSP, "4d": FOURD };

export function useTerms(): Terms {
  return TERMS[useConfig((s) => s.config.mode)];
}

export const MODE_INFO: Record<InterfaceMode, { title: string; blurb: string; points: string[] }> = {
  p6: {
    title: "P6 style",
    blurb: "For planners who work in Primavera P6.",
    points: ["Activity table and Gantt across the top", "Activity details tabs underneath", "Activity ID, WBS, Data Date, Total Float", "3D view in its own panel when you need it"],
  },
  msp: {
    title: "MS Project style",
    blurb: "For teams who know Microsoft Project.",
    points: ["Ribbon-style tabs: Task, Resource, Report, View", "Gantt with outline numbers and Predecessors column", "Task, Status Date, Total Slack", "Task form below the Gantt"],
  },
  "4d": {
    title: "4D style",
    blurb: "Model-first, for 4D planning and reviews.",
    points: ["3D model in the middle", "Gantt on the left, tools on the right", "Timeline with play controls along the bottom", "Linking, profiles and paths one click away"],
  },
};
