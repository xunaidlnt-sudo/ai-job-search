// 4D simulation: given a playback date, work out how every model element should look.

import { growthClip, type Clip } from "./motion";
import { STATUS_COLORS } from "./profiles";
import type { Activity, AppearanceProfile, ColorMode, DateSource, Link, PhaseAppearance, Schedule } from "./types";

export type Phase = "before" | "active" | "after";

export interface ElementState {
  visible: boolean;
  color: string | null; // null = original model colour
  transparency: number;
  /** Show only part of the element (directional growth). */
  clip?: Clip | null;
}

export interface SimulationOptions {
  dateSource: DateSource;
  colorMode: ColorMode;
  /** How elements with no link are drawn. */
  unlinked: "show" | "ghost" | "hide";
  /** Draw equipment paths in the 3D view. */
  showPaths?: boolean;
}

export const DEFAULT_SIM_OPTIONS: SimulationOptions = { dateSource: "current", colorMode: "profile", unlinked: "ghost", showPaths: true };

export function activityDates(a: Activity, source: DateSource): { start: number | null; finish: number | null } {
  if (source === "baseline") return { start: a.baselineStart ?? a.start, finish: a.baselineFinish ?? a.finish };
  return { start: a.start, finish: a.finish };
}

export function phaseAt(a: Activity, t: number, source: DateSource): { phase: Phase; progress: number } {
  const { start, finish } = activityDates(a, source);
  if (start === null || finish === null) return { phase: "before", progress: 0 };
  if (t < start) return { phase: "before", progress: 0 };
  if (t >= finish) return { phase: "after", progress: 1 };
  const span = finish - start;
  return { phase: "active", progress: span > 0 ? (t - start) / span : 1 };
}

export type StatusAt = "not-started" | "in-progress" | "complete" | "late";

/** Status of an activity at playback date t. "late" means it should have finished by the baseline but has not. */
export function statusAt(a: Activity, t: number): StatusAt {
  const { phase } = phaseAt(a, t, "current");
  if (phase === "after") return "complete";
  if (a.baselineFinish !== null && t > a.baselineFinish) return "late";
  return phase === "active" ? "in-progress" : "not-started";
}

function fromPhase(p: PhaseAppearance): ElementState {
  return { visible: p.visible, color: p.color, transparency: p.transparency };
}

/**
 * When an element is linked to several activities, pick the one that governs at t:
 * an active task wins; otherwise the most recently finished task; otherwise the
 * next task to start. So "install" then a later "remove" behaves as expected.
 */
function priority(phase: Phase, start: number, finish: number): [number, number] {
  if (phase === "active") return [3, start];
  if (phase === "after") return [2, finish];
  return [1, -start];
}

export function computeStates(
  schedule: Schedule,
  links: Link[],
  profiles: AppearanceProfile[],
  elementIds: string[],
  t: number,
  options: SimulationOptions = DEFAULT_SIM_OPTIONS,
): Map<string, ElementState> {
  const actById = new Map(schedule.activities.map((a) => [a.id, a]));
  const profById = new Map(profiles.map((p) => [p.id, p]));
  const fallback = profiles[0];

  const best = new Map<string, { score: number; tie: number; state: ElementState }>();
  for (const link of links) {
    const act = actById.get(link.activityId);
    if (!act) continue;
    const profile = profById.get(link.profileId) ?? fallback;
    const { phase, progress } = phaseAt(act, t, options.dateSource);
    let state: ElementState;
    if (options.colorMode === "status") {
      const s = statusAt(act, t);
      const base = fromPhase(profile[phase]);
      const color = s === "in-progress" && act.critical ? STATUS_COLORS.critical : STATUS_COLORS[s];
      state = { visible: base.visible || s === "late", color, transparency: s === "not-started" ? 0.7 : 0 };
    } else {
      state = fromPhase(profile[phase]);
      if (phase === "active" && profile.progressiveFade) {
        state.transparency = state.transparency * (1 - progress);
      }
      if (phase === "active" && profile.growth && profile.growth !== "none") {
        state.clip = growthClip(profile.growth, progress);
      }
    }
    const d = activityDates(act, options.dateSource);
    const [score, tie] = priority(phase, d.start ?? 0, d.finish ?? 0);
    const prev = best.get(link.elementId);
    if (!prev || score > prev.score || (score === prev.score && tie > prev.tie)) {
      best.set(link.elementId, { score, tie, state });
    }
  }

  const out = new Map<string, ElementState>();
  for (const id of elementIds) {
    const hit = best.get(id);
    if (hit) out.set(id, hit.state);
    else if (options.unlinked === "hide") out.set(id, { visible: false, color: null, transparency: 0 });
    else if (options.unlinked === "ghost") out.set(id, { visible: true, color: "#c9ced6", transparency: 0.85 });
    else out.set(id, { visible: true, color: null, transparency: 0 });
  }
  return out;
}

export function scheduleRange(schedule: Schedule, source: DateSource = "current"): { start: number; finish: number } | null {
  let start = Infinity;
  let finish = -Infinity;
  for (const a of schedule.activities) {
    const d = activityDates(a, source);
    if (d.start !== null) start = Math.min(start, d.start);
    if (d.finish !== null) finish = Math.max(finish, d.finish);
  }
  if (!Number.isFinite(start) || !Number.isFinite(finish)) return null;
  return { start, finish };
}

/** Activities whose task is under way at time t (for the "active now" list). */
export function activeAt(schedule: Schedule, t: number, source: DateSource): Activity[] {
  return schedule.activities.filter((a) => a.type !== "wbs-summary" && phaseAt(a, t, source).phase === "active");
}
