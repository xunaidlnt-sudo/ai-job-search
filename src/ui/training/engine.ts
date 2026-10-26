// Training mode: lesson model, progress store and the small DOM helpers the
// "Show me" buttons use to drive the real interface.

import type { ReactNode } from "react";
import { create } from "zustand";
import { useConfig } from "../../backend/config";
import type { AppConfig } from "../../backend/config";
import type { Activity } from "../../core/types";
import { useStore, type AppState } from "../store";

/** Things the lessons can ask the app to do (registered by App). */
export interface TrainingBridge {
  loadSample: () => void;
  schedule: () => void;
}
export const bridge: { actions: TrainingBridge | null } = { actions: null };
export function registerTrainingBridge(a: TrainingBridge) {
  bridge.actions = a;
}

export interface Ctx {
  s: AppState;
  cfg: AppConfig;
  /** Activity by its ID (code). */
  act: (code: string) => Activity | undefined;
  /** The selected activity. */
  sel: () => Activity | undefined;
  /** Scratch memory for one run of a lesson (e.g. values captured at the start). */
  mem: Record<string, unknown>;
}

export function makeCtx(mem: Record<string, unknown>): Ctx {
  const s = useStore.getState();
  return {
    s,
    cfg: useConfig.getState().config,
    act: (code) => s.schedule?.activities.find((a) => a.code === code),
    sel: () => s.schedule?.activities.find((a) => a.id === s.selectedActivity),
    mem,
  };
}

export type Target = string | (() => Element | null);

export interface Quiz {
  q: string;
  options: string[];
  answer: number;
  explain: string;
}

export interface Step {
  title: string;
  /** Explanation shown on the card. */
  body: (c: Ctx) => ReactNode;
  /** What the learner should do now; omit for read-only steps. */
  task?: string;
  /** Element to spotlight. */
  target?: Target;
  /** True when the task is done: the card ticks and moves on. */
  done?: (c: Ctx) => boolean;
  /** Does the task for the learner. */
  showMe?: (c: Ctx) => void | Promise<void>;
  /** Runs when the step opens. */
  enter?: (c: Ctx) => void;
  quiz?: Quiz;
}

export interface Lesson {
  id: string;
  course: string;
  title: string;
  minutes: number;
  level: "Beginner" | "Intermediate" | "Advanced";
  summary: string;
  learn: string[];
  /** Layout and data the lesson needs; a "Get ready" step is added automatically. */
  needs: { mode?: "p6" | "msp" | "4d"; reports?: boolean; sample?: boolean };
  steps: Step[];
}

// ---------------------------------------------------------------- progress

const KEY = "stratum.training.v1";
interface Saved {
  done: Record<string, true>;
  lessonId: string | null;
  step: number;
}
function load(): Saved {
  try {
    const j = JSON.parse(localStorage.getItem(KEY) ?? "");
    return { done: j.done ?? {}, lessonId: j.lessonId ?? null, step: j.step ?? 0 };
  } catch {
    return { done: {}, lessonId: null, step: 0 };
  }
}

interface TrainingState extends Saved {
  catalog: boolean;
  minimized: boolean;
  openCatalog: (on?: boolean) => void;
  start: (lessonId: string, step?: number) => void;
  go: (step: number) => void;
  finish: (lessonId: string) => void;
  exit: () => void;
  setMinimized: (m: boolean) => void;
  reset: () => void;
}

const persist = (st: Saved) => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ done: st.done, lessonId: st.lessonId, step: st.step }));
  } catch {
    /* private window */
  }
};

export const useTraining = create<TrainingState>((set, get) => ({
  ...load(),
  catalog: false,
  minimized: false,
  openCatalog: (on = true) => set({ catalog: on }),
  start: (lessonId, step = 0) => {
    set({ lessonId, step, catalog: false, minimized: false });
    persist(get());
  },
  go: (step) => {
    set({ step });
    persist(get());
  },
  finish: (lessonId) => {
    set({ done: { ...get().done, [lessonId]: true } });
    persist(get());
  },
  exit: () => {
    set({ lessonId: null, step: 0 });
    persist(get());
  },
  setMinimized: (minimized) => set({ minimized }),
  reset: () => {
    set({ done: {}, lessonId: null, step: 0 });
    persist(get());
  },
}));

// ---------------------------------------------------------------- DOM helpers

const visible = (el: Element) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};

/** First visible element matching the selector. */
export function $(sel: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(sel)) if (visible(el)) return el;
  return null;
}

/** First visible element matching the selector whose text contains `text`. */
export function byText(sel: string, text: string, exact = false): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(sel)) {
    const t = (el.textContent ?? "").trim();
    if ((exact ? t === text : t.includes(text)) && visible(el)) return el;
  }
  return null;
}

export function resolve(t: Target | undefined): Element | null {
  if (!t) return null;
  return typeof t === "string" ? $(t) : t();
}

export function click(t: Target) {
  const el = resolve(t) as HTMLElement | null;
  el?.click();
  return !!el;
}

/** Set an input or select the way a person would, so React sees the change. */
export function setValue(t: Target, value: string) {
  const el = resolve(t) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
  if (!el) return false;
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  return true;
}

export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The activity row in the Gantt for an activity ID. */
export const row = (code: string) => () => {
  for (const el of document.querySelectorAll<HTMLElement>(".gantt-row:not(.wbs)")) if (visible(el) && (el.textContent ?? "").includes(code)) return el;
  return null;
};
