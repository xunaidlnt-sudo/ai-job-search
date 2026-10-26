// Stratum project file (.stratum.json): schedule, links, rules and profiles.
// The model itself is not embedded; elements are re-matched by GlobalId when
// the same IFC file is loaded again.

import { DEFAULT_PROFILES } from "./profiles";
import type { AppearanceProfile, ElementGroup, ElementSegment, Link, LinkRule, MotionPath, Schedule } from "./types";

export const PROJECT_FORMAT = "stratum-project";
export const PROJECT_VERSION = 2;

export interface StratumProject {
  format: typeof PROJECT_FORMAT;
  version: number;
  savedAt: string;
  modelFileName: string | null;
  schedule: Schedule | null;
  links: Link[];
  rules: LinkRule[];
  profiles: AppearanceProfile[];
  segments?: ElementSegment[];
  groups?: ElementGroup[];
  paths?: MotionPath[];
}

export function serializeProject(p: Omit<StratumProject, "format" | "version" | "savedAt">): string {
  const doc: StratumProject = { format: PROJECT_FORMAT, version: PROJECT_VERSION, savedAt: new Date().toISOString(), ...p };
  return JSON.stringify(doc, null, 2);
}

export function parseProject(text: string): StratumProject {
  const doc = JSON.parse(text) as Partial<StratumProject>;
  if (doc.format !== PROJECT_FORMAT) throw new Error("Not a Stratum project file");
  if ((doc.version ?? 0) > PROJECT_VERSION) throw new Error(`Project file version ${doc.version} is newer than this app supports`);
  return {
    format: PROJECT_FORMAT,
    version: doc.version ?? PROJECT_VERSION,
    savedAt: doc.savedAt ?? "",
    modelFileName: doc.modelFileName ?? null,
    schedule: doc.schedule ?? null,
    links: Array.isArray(doc.links) ? doc.links : [],
    rules: Array.isArray(doc.rules) ? doc.rules : [],
    profiles: Array.isArray(doc.profiles) && doc.profiles.length ? doc.profiles : structuredClone(DEFAULT_PROFILES),
    segments: Array.isArray(doc.segments) ? doc.segments : [],
    groups: Array.isArray(doc.groups) ? doc.groups : [],
    paths: Array.isArray(doc.paths) ? doc.paths : [],
  };
}
