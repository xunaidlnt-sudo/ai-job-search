// The user's app configuration: interface mode, where data lives, and the
// server session. Kept in localStorage (it is per user and per device).

import { create } from "zustand";
import type { InterfaceMode, StorageKind } from "../core/reporting";
import { browserBackend } from "./browser";
import { desktopBackend } from "./desktop";
import { serverBackend } from "./server";
import type { Backend, SessionUser } from "./types";

export interface AppConfig {
  configured: boolean;
  mode: InterfaceMode;
  storage: StorageKind;
  serverUrl: string;
  token: string | null;
  user: SessionUser | null;
  serverPdf: boolean;
}

const KEY = "stratum.config.v1";

const DEFAULT: AppConfig = { configured: false, mode: "4d", storage: "local", serverUrl: "", token: null, user: null, serverPdf: true };

function load(): AppConfig {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT, ...JSON.parse(raw) } : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

function save(c: AppConfig) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    // storage blocked: config lasts for this session only
  }
}

export const isDesktop = () => typeof window !== "undefined" && !!window.stratumDesktop?.invoke;

export function makeBackend(c: AppConfig): Backend {
  if (c.storage === "server" && c.serverUrl && c.token) return serverBackend(c.serverUrl, c.token, c.user, c.serverPdf);
  return isDesktop() ? desktopBackend() : browserBackend();
}

interface ConfigState {
  config: AppConfig;
  backend: Backend;
  update: (patch: Partial<AppConfig>) => void;
  signOut: () => void;
}

export const useConfig = create<ConfigState>((set) => {
  const config = load();
  return {
    config,
    backend: makeBackend(config),
    update: (patch) =>
      set((st) => {
        const next = { ...st.config, ...patch };
        save(next);
        const backendChanged =
          next.storage !== st.config.storage || next.serverUrl !== st.config.serverUrl || next.token !== st.config.token || next.user?.email !== st.config.user?.email;
        return { config: next, backend: backendChanged ? makeBackend(next) : st.backend };
      }),
    signOut: () =>
      set((st) => {
        const next = { ...st.config, token: null, user: null, storage: "local" as StorageKind };
        save(next);
        return { config: next, backend: makeBackend(next) };
      }),
  };
});

/** Report rendering (#report=…): a one-off backend from the URL, used by the PDF renderer. */
export function reportRoute(): { dashboardId: string; projectId: string | null; backend: Backend } | null {
  const h = new URLSearchParams(location.hash.slice(1));
  const dashboardId = h.get("report");
  if (!dashboardId) return null;
  const token = h.get("token");
  const server = h.get("server") ?? location.origin;
  const backend = token ? serverBackend(server, token, null) : isDesktop() ? desktopBackend() : browserBackend();
  return { dashboardId, projectId: h.get("project"), backend };
}
