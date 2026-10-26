import { useEffect, useState } from "react";
import { useConfig } from "../backend/config";
import type { P6ProjectInfo, ProjectSummary } from "../backend/types";
import type { P6Connection } from "../core/reporting";
import type { Schedule } from "../core/types";
import { fmtDate, useStore } from "./store";
import { useTerms } from "./terms";

export function ProjectsDialog({
  onClose,
  onOpen,
  onSave,
  onImportP6,
  initialTab = "database",
}: {
  onClose: () => void;
  onOpen: (id: string) => Promise<void>;
  onSave: (asNew: boolean) => Promise<void>;
  onImportP6: (schedule: Schedule, connection: P6Connection) => void;
  initialTab?: "database" | "p6";
}) {
  const { backend } = useConfig();
  const t = useTerms();
  const { currentProjectId, schedule } = useStore();
  const [tab, setTab] = useState<"database" | "p6">(initialTab);
  const [list, setList] = useState<ProjectSummary[] | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () =>
    backend
      .listProjects()
      .then(setList)
      .catch((e) => setMsg(e.message));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend]);

  return (
    <div className="help-backdrop" onClick={onClose}>
      <div className="help settings" role="dialog" aria-label={t.projects} onClick={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <h2>{t.projects}</h2>
          <button onClick={onClose}>Close</button>
        </div>
        <p className="muted">{backend.label}</p>
        <div className="tabs">
          <button className={tab === "database" ? "active" : ""} onClick={() => setTab("database")}>
            Database
          </button>
          <button className={tab === "p6" ? "active" : ""} onClick={() => setTab("p6")}>
            Import from P6
          </button>
        </div>
        <div className="settings-body">
          {tab === "database" && (
            <div className="stack">
              <div className="row">
                <button
                  className="primary"
                  disabled={!schedule || busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await onSave(false);
                      setMsg("Saved.");
                      await load();
                    } catch (e) {
                      setMsg((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {currentProjectId ? "Save" : "Save to database"}
                </button>
                {currentProjectId && (
                  <button
                    disabled={!schedule || busy}
                    onClick={async () => {
                      await onSave(true);
                      setMsg("Saved as a new project.");
                      await load();
                    }}
                  >
                    Save as new
                  </button>
                )}
              </div>
              {list === null ? (
                <p className="muted">Loading…</p>
              ) : list.length === 0 ? (
                <p className="muted">No projects in the database yet. Open or import a schedule, then Save.</p>
              ) : (
                <table className="data">
                  <thead>
                    <tr>
                      <th>{t.project}</th>
                      <th>Name</th>
                      <th>{t.dataDate}</th>
                      <th>Saved</th>
                      <th>By</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((p) => (
                      <tr key={p.id} className={p.id === currentProjectId ? "current" : ""}>
                        <td>
                          <b>{p.code}</b>
                        </td>
                        <td>{p.name}</td>
                        <td>{fmtDate(p.dataDate)}</td>
                        <td>
                          {new Date(p.updatedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })} (v{p.version})
                        </td>
                        <td>{p.updatedBy ?? ""}</td>
                        <td>
                          <button
                            className="link"
                            onClick={async () => {
                              setBusy(true);
                              try {
                                await onOpen(p.id);
                                onClose();
                              } catch (e) {
                                setMsg((e as Error).message);
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            open
                          </button>
                          <button
                            className="link"
                            onClick={async () => {
                              if (!window.confirm(`Delete ${p.code} – ${p.name} from the database?`)) return;
                              try {
                                await backend.deleteProject(p.id);
                                await load();
                              } catch (e) {
                                setMsg((e as Error).message);
                              }
                            }}
                          >
                            delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
          {tab === "p6" && <P6Import onImport={onImportP6} onClose={onClose} />}
          {msg && <p className={/conflict|error|cannot|someone else|fail/i.test(msg) ? "bad" : "muted"}>{msg}</p>}
        </div>
      </div>
    </div>
  );
}

function P6Import({ onImport, onClose }: { onImport: (s: Schedule, c: P6Connection) => void; onClose: () => void }) {
  const { backend } = useConfig();
  const [conns, setConns] = useState<P6Connection[]>([]);
  const [conn, setConn] = useState("");
  const [projects, setProjects] = useState<P6ProjectInfo[] | null>(null);
  const [filter, setFilter] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!backend.caps.p6) return;
    backend
      .getP6()
      .then((c) => {
        setConns(c);
        if (c[0]) setConn(c[0].id);
      })
      .catch((e) => setMsg(e.message));
  }, [backend]);

  if (!backend.caps.p6) return <p className="muted">P6 connections need the desktop app or a Stratum Server. Use Import schedule with an XER file instead.</p>;
  if (!conns.length) return <p className="muted">No P6 connections yet. Add one in Settings → Primavera P6.</p>;
  const shown = (projects ?? []).filter((p) => `${p.code} ${p.name}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="stack">
      <div className="row">
        <select value={conn} onChange={(e) => (setConn(e.target.value), setProjects(null))}>
          {conns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setMsg("Connecting to P6…");
            try {
              setProjects(await backend.p6Projects(conn));
              setMsg("");
            } catch (e) {
              setMsg((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          List projects
        </button>
        {projects && <input placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ flex: 1 }} />}
      </div>
      {projects && (
        <table className="data">
          <thead>
            <tr>
              <th>Project ID</th>
              <th>Name</th>
              <th>Data date</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, 300).map((p) => (
              <tr key={p.objectId}>
                <td>
                  <b>{p.code}</b>
                </td>
                <td>{p.name}</td>
                <td>{p.dataDate.slice(0, 10)}</td>
                <td>
                  <button
                    className="link"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setMsg(`Importing ${p.code}…`);
                      try {
                        const s = await backend.p6Import(conn, p.objectId);
                        onImport(s, conns.find((c) => c.id === conn)!);
                        onClose();
                      } catch (e) {
                        setMsg((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    import
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {msg && <p className={/fail|error|cannot|refused|denied/i.test(msg) ? "bad" : "muted"}>{msg}</p>}
    </div>
  );
}
