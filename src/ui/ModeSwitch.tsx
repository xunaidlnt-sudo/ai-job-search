// Layout switch in the top bar: P6, MS Project or 4D, plus Reports (the
// dashboard builder). Same project, same engine; only the layout and wording
// change. Ctrl+Alt+1/2/3 switch layout, Ctrl+Alt+4 opens Reports.

import { Boxes, ChartGantt, LayoutDashboard, Moon, PanelsTopLeft, Sun } from "lucide-react";
import { useEffect } from "react";
import { useConfig } from "../backend/config";
import type { InterfaceMode } from "../core/reporting";
import { effectiveTheme } from "./appearance";
import { useStore } from "./store";

const MODES: { id: InterfaceMode; short: string; title: string; Icon: typeof Boxes }[] = [
  { id: "p6", short: "P6", title: "P6 style layout (Ctrl+Alt+1)", Icon: ChartGantt },
  { id: "msp", short: "Project", title: "MS Project style layout (Ctrl+Alt+2)", Icon: PanelsTopLeft },
  { id: "4d", short: "4D", title: "4D style layout (Ctrl+Alt+3)", Icon: Boxes },
];

export function ModeSwitch() {
  const mode = useConfig((s) => s.config.mode);
  const update = useConfig((s) => s.update);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const reports = view === "dashboards";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey && e.altKey)) return;
      const i = ["1", "2", "3", "4"].indexOf(e.key);
      if (i < 0) return;
      e.preventDefault();
      if (i === 3) return setView("dashboards");
      update({ mode: MODES[i].id });
      setView("workspace");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [update, setView]);

  return (
    <div className="mode-switch" role="radiogroup" aria-label="Interface layout">
      {MODES.map(({ id, short, title, Icon }) => {
        const on = !reports && mode === id;
        return (
          <button
            key={id}
            role="radio"
            aria-checked={on}
            className={on ? "on" : ""}
            title={title}
            onClick={() => {
              update({ mode: id });
              setView("workspace");
            }}
          >
            <Icon size={15} strokeWidth={2} aria-hidden />
            <span>{short}</span>
          </button>
        );
      })}
      <span className="mode-sep" aria-hidden />
      <button role="radio" aria-checked={reports} className={`mode-reports ${reports ? "on" : ""}`} title="Reports and dashboards (Ctrl+Alt+4)" onClick={() => setView("dashboards")}>
        <LayoutDashboard size={15} strokeWidth={2} aria-hidden />
        <span>Reports</span>
      </button>
    </div>
  );
}

/** Quick light/dark flip; Settings has the full choice including "follow the layout". */
export function ThemeButton() {
  const config = useConfig((s) => s.config);
  const update = useConfig((s) => s.update);
  const dark = effectiveTheme(config) === "dark";
  return (
    <button className="tb icon-only" title={dark ? "Switch to light theme" : "Switch to dark theme"} onClick={() => update({ theme: dark ? "light" : "dark" })}>
      {dark ? <Sun size={16} aria-hidden /> : <Moon size={16} aria-hidden />}
    </button>
  );
}
