// Fonts, light/dark theme and density. All fonts ship with the app (no
// downloads), so the desktop build looks the same offline.

import "@fontsource-variable/inter";
import "@fontsource-variable/ibm-plex-sans";
import "@fontsource-variable/source-sans-3";
import "@fontsource-variable/nunito-sans";
import "@fontsource-variable/jetbrains-mono";
import { useEffect } from "react";
import type { AppConfig } from "../backend/config";
import { useConfig } from "../backend/config";
import type { InterfaceMode } from "../core/reporting";

export interface FontChoice {
  id: string;
  label: string;
  note: string;
  stack: string;
  /** OpenType features that give the face its Stratum character. */
  features: string;
}

export const FONTS: FontChoice[] = [
  {
    id: "stratum",
    label: "Stratum Sans",
    note: "House style, built on Inter with single-storey a, open digits and a tailed l",
    stack: '"Inter Variable", system-ui, sans-serif',
    features: '"cv11" 1, "ss01" 1, "cv05" 1',
  },
  { id: "plex", label: "IBM Plex Sans", note: "Engineering feel, very legible in dense tables", stack: '"IBM Plex Sans Variable", system-ui, sans-serif', features: '"kern" 1' },
  { id: "source", label: "Source Sans 3", note: "Compact and calm, close to classic enterprise tools", stack: '"Source Sans 3 Variable", system-ui, sans-serif', features: '"kern" 1' },
  { id: "nunito", label: "Nunito Sans", note: "Rounded and friendly", stack: '"Nunito Sans Variable", system-ui, sans-serif', features: '"kern" 1' },
  { id: "mono", label: "JetBrains Mono", note: "Monospaced, every column lines up", stack: '"JetBrains Mono Variable", ui-monospace, monospace', features: '"kern" 1' },
  { id: "system", label: "System font", note: "Segoe UI on Windows, San Francisco on macOS", stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', features: '"kern" 1' },
];

export const fontById = (id: string) => FONTS.find((f) => f.id === id) ?? FONTS[0];

/** Each mode's own look when theme is "mode". */
const MODE_THEME: Record<InterfaceMode, "light" | "dark"> = { p6: "light", msp: "light", "4d": "dark" };

export function effectiveTheme(c: Pick<AppConfig, "theme" | "mode">): "light" | "dark" {
  return c.theme === "mode" ? MODE_THEME[c.mode] : c.theme;
}

export function applyAppearance(c: AppConfig) {
  const root = document.documentElement;
  const f = fontById(c.font);
  root.dataset.mode = c.mode;
  root.dataset.theme = effectiveTheme(c);
  root.dataset.density = c.density;
  root.style.setProperty("--font", f.stack);
  root.style.setProperty("--font-features", f.features);
  root.style.setProperty("--font-size", `${c.fontSize}px`);
  root.style.colorScheme = effectiveTheme(c);
}

export function useAppearance() {
  const config = useConfig((s) => s.config);
  useEffect(() => applyAppearance(config), [config]);
  return effectiveTheme(config);
}
