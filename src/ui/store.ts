import { create } from "zustand";
import { DEFAULT_PROFILES } from "../core/profiles";
import { DEFAULT_SIM_OPTIONS, scheduleRange, type SimulationOptions } from "../core/simulation";
import type { AppearanceProfile, Link, LinkRule, ModelElement, Schedule } from "../core/types";

const DAY = 86_400_000;

export interface AppState {
  schedule: Schedule | null;
  elements: ModelElement[];
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

  setSchedule: (s: Schedule | null) => void;
  setModel: (elements: ModelElement[], fileName: string | null) => void;
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
}

export const useStore = create<AppState>((set) => ({
  schedule: null,
  elements: [],
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
  status: "Load a P6 XER schedule and an IFC model, or open the demo.",
  busy: false,
  collapsedWbs: new Set(),

  setSchedule: (schedule) =>
    set(() => {
      if (!schedule) return { schedule, selectedActivity: null };
      const r = scheduleRange(schedule);
      const time = schedule.dataDate ?? r?.start ?? Date.now();
      return { schedule, time, selectedActivity: null, collapsedWbs: new Set() };
    }),
  setModel: (elements, modelFileName) => set({ elements, modelFileName, selectedElements: new Set() }),
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
}));

export { DAY };

export function fmtDate(t: number | null | undefined): string {
  if (t === null || t === undefined) return "";
  const d = new Date(t);
  return `${String(d.getUTCDate()).padStart(2, "0")}-${d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}-${String(d.getUTCFullYear()).slice(2)}`;
}
