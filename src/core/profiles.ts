// Appearance profiles: how a linked element looks before, during and after its task.
// The five built-in actions cover the usual construction cases. Users can copy
// and edit them, or create their own.

import type { AppearanceProfile, PhaseAppearance } from "./types";

const original = (transparency = 0): PhaseAppearance => ({ visible: true, color: null, transparency });
const colored = (color: string, transparency = 0): PhaseAppearance => ({ visible: true, color, transparency });
const hidden: PhaseAppearance = { visible: false, color: null, transparency: 0 };

export const DEFAULT_PROFILES: AppearanceProfile[] = [
  {
    id: "install",
    name: "Install",
    action: "install",
    before: hidden,
    active: colored("#2e9d4f", 0.25),
    after: original(),
    progressiveFade: true,
  },
  {
    id: "remove",
    name: "Remove",
    action: "remove",
    before: original(),
    active: colored("#d64545", 0.2),
    after: hidden,
    progressiveFade: false,
  },
  {
    id: "temporary",
    name: "Temporary",
    action: "temporary",
    before: hidden,
    active: colored("#e0a526", 0.35),
    after: hidden,
    progressiveFade: false,
  },
  {
    id: "maintain",
    name: "Maintain",
    action: "maintain",
    before: original(),
    active: colored("#3b7dd8"),
    after: original(),
    progressiveFade: false,
  },
  {
    id: "neutral",
    name: "Neutral",
    action: "neutral",
    before: original(),
    active: colored("#8a8f98"),
    after: original(),
    progressiveFade: false,
  },
];

export const DEFAULT_PROFILE_ID = "install";

/** Colours used in "status" colour mode, keyed by computed status at the playback date. */
export const STATUS_COLORS = {
  "not-started": "#b9bec7",
  "in-progress": "#2e9d4f",
  complete: "#6f7682",
  late: "#d64545",
  critical: "#c2410c",
} as const;

export function cloneProfile(p: AppearanceProfile, id: string, name: string): AppearanceProfile {
  return { ...structuredClone(p), id, name };
}
