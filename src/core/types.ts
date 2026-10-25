// Shared data model for Stratum. Dates are stored as epoch milliseconds (UTC)
// so they serialise cleanly to JSON and compare cheaply during playback.

export type ActivityType = "task" | "milestone" | "finish-milestone" | "loe" | "wbs-summary" | "resource-dependent";
export type ActivityStatus = "not-started" | "in-progress" | "complete";
export type RelationshipType = "FS" | "SS" | "FF" | "SF";

export interface Activity {
  id: string; // internal P6 task_id
  code: string; // user-facing Activity ID (task_code)
  name: string;
  wbsId: string | null;
  type: ActivityType;
  status: ActivityStatus;
  percentComplete: number; // 0..100
  /** Current schedule: actual dates where they exist, otherwise early/remaining dates. */
  start: number | null;
  finish: number | null;
  /** Baseline / target dates from P6 (target_start_date / target_end_date). */
  baselineStart: number | null;
  baselineFinish: number | null;
  actualStart: number | null;
  actualFinish: number | null;
  totalFloatHours: number | null;
  originalDurationHours: number | null;
  remainingDurationHours: number | null;
  critical: boolean;
  calendarId: string | null;
  /** Activity code assignments: code type name -> code value. */
  codes: Record<string, string>;
}

export interface WbsNode {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
  seq: number;
}

export interface Relationship {
  id: string;
  predecessorId: string;
  successorId: string;
  type: RelationshipType;
  lagHours: number;
}

export interface Schedule {
  projectId: string;
  projectCode: string;
  projectName: string;
  dataDate: number | null;
  activities: Activity[];
  wbs: WbsNode[];
  relationships: Relationship[];
}

/** A model element (IFC product or demo element) as seen by the linking engine. */
export interface ModelElement {
  id: string; // stable key: GlobalId when available
  expressId: number;
  ifcType: string;
  name: string;
  properties: Record<string, string>;
}

export type ProfileAction = "install" | "remove" | "temporary" | "maintain" | "neutral";

/** How an element looks in one phase of its task (before / during / after). */
export interface PhaseAppearance {
  visible: boolean;
  /** Hex colour, or null to keep the element's original model colour. */
  color: string | null;
  /** 0 = opaque, 1 = fully transparent. */
  transparency: number;
}

export interface AppearanceProfile {
  id: string;
  name: string;
  action: ProfileAction;
  before: PhaseAppearance;
  active: PhaseAppearance;
  after: PhaseAppearance;
  /** During the task, fade the active transparency in proportion to task progress. */
  progressiveFade: boolean;
}

export interface Link {
  elementId: string;
  activityId: string;
  profileId: string;
}

export type LinkMatch = "equals" | "contains" | "startsWith";

export interface LinkRule {
  id: string;
  /** Element property key, e.g. "Name", "IfcType", "Storey", "Pset_Stratum.ActivityID". */
  elementProperty: string;
  /** Activity field: "code" | "name" | "wbs" | "code:<Activity Code Type>". */
  activityField: string;
  match: LinkMatch;
  profileId: string;
  caseSensitive: boolean;
}

export type DateSource = "current" | "baseline";
export type ColorMode = "profile" | "status";
