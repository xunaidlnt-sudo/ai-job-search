import { create } from "zustand";
import { expandElements } from "../core/motion";
import { DEFAULT_PROFILES } from "../core/profiles";
import { DEFAULT_SIM_OPTIONS, scheduleRange, type SimulationOptions } from "../core/simulation";
import type {
  Activity,
  AppearanceProfile,
  Assignment,
  ElementGroup,
  ElementSegment,
  Link,
  LinkRule,
  ModelElement,
  MotionPath,
  Relationship,
  Schedule,
} from "../core/types";
import type { ScheduleDiff } from "../core/update";

export type SideTab = "selection" | "rules" | "profiles" | "display" | "check" | "tools";
export type LeftTab = "gantt" | "activity" | "cost" | "resources" | "quantities";

const DAY = 86_400_000;

export interface ScheduleReport {
  at: number;
  projectFinish: number;
  previousFinish: number | null;
  criticalCount: number;
  warnings: string[];
  error?: string;
}

export interface AppState {
  schedule: Schedule | null;
  /** Elements as loaded from the model. */
  baseElements: ModelElement[];
  /** Elements the app works with: split parents replaced by segments, group names added. */
  elements: ModelElement[];
  segments: ElementSegment[];
  groups: ElementGroup[];
  paths: MotionPath[];
  modelFileName: string | null;
  links: Link[];
  rules: LinkRule[];
  profiles: AppearanceProfile[];
  selectedElements: Set<string>;
  selectedActivity: string | null;
  time: number;
  playing: boolean;
  /** Playback speed in schedule days per real second. */
  speed: number;
  sim: SimulationOptions;
  status: string;
  busy: boolean;
  collapsedWbs: Set<string>;
  lastUpdate: (ScheduleDiff & { droppedLinks: number; keptLinks: number; at: number }) | null;
  sideTab: SideTab;
  leftTab: LeftTab;
  /** True when the schedule was edited since the last CPM run. */
  scheduleDirty: boolean;
  scheduleReport: ScheduleReport | null;
  /** Path being drawn in the viewport. */
  pathDraft: [number, number, number][] | null;
  /** Database identity of the open project (null = not saved to the database yet). */
  currentProjectId: string | null;
  currentVersion: number | null;
  /** Full-screen views over the workspace. */
  view: "workspace" | "dashboards";
  dialog: null | "projects" | "settings" | "p6";

  setLastUpdate: (u: AppState["lastUpdate"]) => void;
  setSideTab: (t: SideTab) => void;
  setLeftTab: (t: LeftTab) => void;
  setSchedule: (s: Schedule | null, opts?: { keepTime?: boolean; dirty?: boolean }) => void;
  setModel: (elements: ModelElement[], fileName: string | null) => void;
  setSegments: (s: ElementSegment[]) => void;
  setGroups: (g: ElementGroup[]) => void;
  setPaths: (p: MotionPath[]) => void;
  setPathDraft: (p: [number, number, number][] | null) => void;
  setCurrentProject: (id: string | null, version: number | null) => void;
  setView: (v: AppState["view"]) => void;
  setDialog: (d: AppState["dialog"]) => void;
  setLinks: (links: Link[]) => void;
  setRules: (rules: LinkRule[]) => void;
  setProfiles: (p: AppearanceProfile[]) => void;
  selectElements: (ids: Set<string>) => void;
  selectActivity: (id: string | null) => void;
  setTime: (t: number) => void;
  setPlaying: (p: boolean) => void;
  setSpeed: (s: number) => void;
  setSim: (patch: Partial<SimulationOptions>) => void;
  setStatus: (msg: string, busy?: boolean) => void;
  toggleWbs: (id: string) => void;
  setScheduleReport: (r: ScheduleReport | null) => void;

  // Schedule editing
  updateActivity: (id: string, patch: Partial<Activity>) => void;
  addActivity: (a: Activity) => void;
  deleteActivity: (id: string) => void;
  addRelationship: (r: Relationship) => void;
  updateRelationship: (id: string, patch: Partial<Relationship>) => void;
  deleteRelationship: (id: string) => void;
  upsertAssignment: (a: Assignment) => void;
  deleteAssignment: (id: string) => void;
}

function derive(base: ModelElement[], segments: ElementSegment[], groups: ElementGroup[]) {
  return expandElements(base, segments, groups);
}

export const useStore = create<AppState>((set) => {
  const editSchedule = (fn: (s: Schedule) => Schedule) =>
    set((st) => (st.schedule ? { schedule: fn(st.schedule), scheduleDirty: true } : {}));

  return {
    schedule: null,
    baseElements: [],
    elements: [],
    segments: [],
    groups: [],
    paths: [],
    modelFileName: null,
    links: [],
    rules: [],
    profiles: structuredClone(DEFAULT_PROFILES),
    selectedElements: new Set(),
    selectedActivity: null,
    time: Date.now(),
    playing: false,
    speed: 7,
    sim: DEFAULT_SIM_OPTIONS,
    status: "Load a P6 XER or MS Project schedule and an IFC model, or open the demo.",
    busy: false,
    collapsedWbs: new Set(),
    lastUpdate: null,
    sideTab: "selection",
    leftTab: "gantt",
    scheduleDirty: false,
    scheduleReport: null,
    pathDraft: null,
    currentProjectId: null,
    currentVersion: null,
    view: "workspace",
    dialog: null,

    setLastUpdate: (lastUpdate) => set({ lastUpdate }),
    setSideTab: (sideTab) => set({ sideTab }),
    setLeftTab: (leftTab) => set({ leftTab }),
    setSchedule: (schedule, opts = {}) =>
      set((st) => {
        if (!schedule) return { schedule, selectedActivity: null, scheduleDirty: false };
        const r = scheduleRange(schedule);
        const time = opts.keepTime ? st.time : schedule.dataDate ?? r?.start ?? Date.now();
        const keepSel = opts.keepTime && st.selectedActivity && schedule.activities.some((a) => a.id === st.selectedActivity);
        return {
          schedule,
          time,
          selectedActivity: keepSel ? st.selectedActivity : null,
          collapsedWbs: opts.keepTime ? st.collapsedWbs : new Set(),
          scheduleDirty: opts.dirty ?? false,
        };
      }),
    setModel: (baseElements, modelFileName) =>
      set((st) => {
        const ids = new Set(baseElements.map((e) => e.id));
        const segments = st.segments.filter((s) => ids.has(s.parentId));
        return { baseElements, modelFileName, segments, elements: derive(baseElements, segments, st.groups), selectedElements: new Set() };
      }),
    setSegments: (segments) => set((st) => ({ segments, elements: derive(st.baseElements, segments, st.groups) })),
    setGroups: (groups) => set((st) => ({ groups, elements: derive(st.baseElements, st.segments, groups) })),
    setPaths: (paths) => set({ paths }),
    setPathDraft: (pathDraft) => set({ pathDraft }),
    setCurrentProject: (currentProjectId, currentVersion) => set({ currentProjectId, currentVersion }),
    setView: (view) => set({ view }),
    setDialog: (dialog) => set({ dialog }),
    setLinks: (links) => set({ links }),
    setRules: (rules) => set({ rules }),
    setProfiles: (profiles) => set({ profiles }),
    selectElements: (selectedElements) => set({ selectedElements }),
    selectActivity: (selectedActivity) => set({ selectedActivity }),
    setTime: (time) => set({ time }),
    setPlaying: (playing) => set({ playing }),
    setSpeed: (speed) => set({ speed }),
    setSim: (patch) => set((s) => ({ sim: { ...s.sim, ...patch } })),
    setStatus: (status, busy = false) => set({ status, busy }),
    toggleWbs: (id) =>
      set((s) => {
        const next = new Set(s.collapsedWbs);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return { collapsedWbs: next };
      }),
    setScheduleReport: (scheduleReport) => set({ scheduleReport }),

    updateActivity: (id, patch) =>
      editSchedule((s) => ({ ...s, activities: s.activities.map((a) => (a.id === id ? { ...a, ...patch } : a)) })),
    addActivity: (a) => editSchedule((s) => ({ ...s, activities: [...s.activities, a] })),
    deleteActivity: (id) =>
      editSchedule((s) => ({
        ...s,
        activities: s.activities.filter((a) => a.id !== id),
        relationships: s.relationships.filter((r) => r.predecessorId !== id && r.successorId !== id),
        assignments: (s.assignments ?? []).filter((x) => x.activityId !== id),
      })),
    addRelationship: (r) => editSchedule((s) => ({ ...s, relationships: [...s.relationships, r] })),
    updateRelationship: (id, patch) =>
      editSchedule((s) => ({ ...s, relationships: s.relationships.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),
    deleteRelationship: (id) => editSchedule((s) => ({ ...s, relationships: s.relationships.filter((r) => r.id !== id) })),
    upsertAssignment: (a) =>
      editSchedule((s) => {
        const list = s.assignments ?? [];
        return { ...s, assignments: list.some((x) => x.id === a.id) ? list.map((x) => (x.id === a.id ? a : x)) : [...list, a] };
      }),
    deleteAssignment: (id) => editSchedule((s) => ({ ...s, assignments: (s.assignments ?? []).filter((x) => x.id !== id) })),
  };
});

export { DAY };

export function fmtDate(t: number | null | undefined): string {
  if (t === null || t === undefined) return "";
  const d = new Date(t);
  return `${String(d.getUTCDate()).padStart(2, "0")}-${d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}-${String(d.getUTCFullYear()).slice(2)}`;
}

/** "2026-03-02T08:00" for <input type="datetime-local"> (UTC wall time). */
export function toInputDate(t: number | null | undefined): string {
  if (t === null || t === undefined) return "";
  return new Date(t).toISOString().slice(0, 16);
}

export function fromInputDate(v: string): number | null {
  if (!v) return null;
  const t = Date.parse(v + (v.length === 16 ? ":00Z" : "Z"));
  return Number.isFinite(t) ? t : null;
}
