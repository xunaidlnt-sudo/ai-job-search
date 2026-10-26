import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { isDesktop, useConfig } from "../backend/config";
import { serverLogin, serverStatus, type serverBackend } from "../backend/server";
import type { CheckStep, P6Diagnosis, SessionUser } from "../backend/types";
import { uid, type InterfaceMode, type P6Connection, type P6ConnectionKind, type SmtpSettings } from "../core/reporting";
import { FONTS } from "./appearance";
import { MODE_INFO } from "./terms";

type Tab = "interface" | "data" | "p6" | "email" | "users";

export function SettingsDialog({ initialTab = "interface", onClose }: { initialTab?: Tab; onClose: () => void }) {
  const { backend } = useConfig();
  const [tab, setTab] = useState<Tab>(initialTab);
  const tabs: [Tab, string][] = [
    ["interface", "Interface"],
    ["data", "Data & sign-in"],
    ["p6", "Primavera P6"],
    ["email", "Email"],
    ...(backend.kind === "server" && backend.user?.role === "admin" ? ([["users", "Users"]] as [Tab, string][]) : []),
  ];
  return (
    <div className="help-backdrop" onClick={onClose}>
      <div className="help settings" role="dialog" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <h2>Settings</h2>
          <button className="tb icon-only" onClick={onClose} title="Close" aria-label="Close">
            <X size={16} aria-hidden />
          </button>
        </div>
        <div className="tabs">
          {tabs.map(([t, l]) => (
            <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
              {l}
            </button>
          ))}
        </div>
        <div className="settings-body">
          {tab === "interface" && <InterfaceTab />}
          {tab === "data" && <DataTab />}
          {tab === "p6" && <P6Tab />}
          {tab === "email" && <EmailTab />}
          {tab === "users" && <UsersTab />}
        </div>
      </div>
    </div>
  );
}

function InterfaceTab() {
  const { config, update } = useConfig();
  const seg = <T extends string>(value: T, opts: [T, string][], set: (v: T) => void) => (
    <div className="seg">
      {opts.map(([v, l]) => (
        <button key={v} className={value === v ? "active" : ""} onClick={() => set(v)}>
          {l}
        </button>
      ))}
    </div>
  );
  return (
    <div className="stack">
      <h4>Layout</h4>
      <p className="muted">Same data and engine in every layout; only the arrangement, wording and default columns change. You can also switch from the top bar or with Ctrl+Alt+1/2/3.</p>
      <div className="mode-cards">
        {(Object.keys(MODE_INFO) as InterfaceMode[]).map((m) => (
          <button key={m} className={`mode-card ${config.mode === m ? "active" : ""}`} onClick={() => update({ mode: m })}>
            <b>{MODE_INFO[m].title}</b>
            <span className="muted">{MODE_INFO[m].blurb}</span>
          </button>
        ))}
      </div>

      <h4>Font</h4>
      <div className="font-list" role="radiogroup" aria-label="Font">
        {FONTS.map((f) => (
          <button
            key={f.id}
            role="radio"
            aria-checked={config.font === f.id}
            className={`font-card ${config.font === f.id ? "active" : ""}`}
            style={{ fontFamily: f.stack, fontFeatureSettings: f.features }}
            onClick={() => update({ font: f.id })}
          >
            <span className="font-name">{f.label}</span>
            <span className="font-sample">ST-210 Level 1 Slab · 15d · 70.0% · 24-Apr-26</span>
            <span className="font-note">{f.note}</span>
          </button>
        ))}
      </div>
      <div className="row wrap appearance-row">
        <label className="inline">
          Text size
          {seg(String(config.fontSize), [["12", "Small"], ["13", "Normal"], ["14", "Large"], ["15", "Larger"]], (v) => update({ fontSize: Number(v) }))}
        </label>
        <label className="inline">
          Theme
          {seg(config.theme, [["mode", "Match layout"], ["light", "Light"], ["dark", "Dark"]], (v) => update({ theme: v }))}
        </label>
        <label className="inline">
          Density
          {seg(config.density, [["compact", "Compact"], ["comfortable", "Comfortable"]], (v) => update({ density: v }))}
        </label>
      </div>
      <p className="muted">
        All fonts are installed with Stratum and work offline. Stratum Sans is Inter (SIL Open Font License) set with its own stylistic alternates; the others are IBM Plex Sans,
        Source Sans 3, Nunito Sans and JetBrains Mono, also under the Open Font License.
      </p>
    </div>
  );
}

function DataTab() {
  const { config, backend, update, signOut } = useConfig();
  const [url, setUrl] = useState(config.serverUrl || (location.protocol.startsWith("http") ? location.origin : ""));
  const [email, setEmail] = useState(config.user?.email ?? "");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [dbFile, setDbFile] = useState("");
  useEffect(() => {
    window.stratumDesktop?.info?.().then((i) => setDbFile(i.dbFile)).catch(() => {});
  }, []);
  return (
    <div className="stack">
      <section>
        <h4>Current</h4>
        <p>
          <b>{backend.label}</b>
          {backend.user ? ` · signed in as ${backend.user.email} (${backend.user.role})` : ""}
        </p>
        {backend.kind === "desktop" && dbFile && <p className="muted">Database file: {dbFile}</p>}
        {backend.kind === "browser" && <p className="muted">Data is kept in this browser. Use the desktop app or a Stratum Server for P6 and emailed reports.</p>}
      </section>
      {backend.kind === "server" ? (
        <section>
          <button
            onClick={() => {
              signOut();
              setMsg("Signed out. Now using local storage.");
            }}
          >
            Sign out and use local storage
          </button>
        </section>
      ) : (
        <section className="stack">
          <h4>Connect to a Stratum Server</h4>
          <label>
            Server address
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://stratum.yourcompany.com" />
          </label>
          <label>
            Email
            <input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </label>
          <div className="row">
            <button
              className="primary"
              disabled={!url || !email || !password}
              onClick={async () => {
                try {
                  const st = await serverStatus(url);
                  if (st.needsSetup) return setMsg("This server has no accounts yet. Run the setup from the wizard (Settings → Interface → re-run setup) or open the server address in a browser.");
                  const r = await serverLogin(url, email, password);
                  update({ storage: "server", serverUrl: url, token: r.token, user: r.user, serverPdf: st.pdf });
                  setMsg("Connected.");
                } catch (e) {
                  setMsg((e as Error).message);
                }
              }}
            >
              Sign in
            </button>
          </div>
          <p className="muted">Projects in your local {isDesktop() ? "database" : "browser"} stay there; open them and Save to copy them to the server.</p>
        </section>
      )}
      {msg && <p className="muted">{msg}</p>}
    </div>
  );
}

const KIND_LABEL: Record<P6ConnectionKind, string> = {
  eppm: "P6 EPPM (web services / REST API)",
  "p6-sqlserver": "P6 Professional – SQL Server database",
  "p6-oracle": "P6 Professional – Oracle database",
  "p6-sqlite": "P6 Professional – standalone SQLite file",
};

function P6Tab() {
  const { backend } = useConfig();
  const [list, setList] = useState<P6Connection[]>([]);
  const [edit, setEdit] = useState<P6Connection | null>(null);
  const [msg, setMsg] = useState("");
  const [diag, setDiag] = useState<{ name: string; d: P6Diagnosis } | null>(null);
  const [testing, setTesting] = useState(false);
  const runTest = async (c: P6Connection) => {
    setMsg("");
    setDiag(null);
    setTesting(true);
    try {
      setDiag({ name: c.name, d: await backend.p6Test(c) });
    } catch (e) {
      setMsg(`${c.name}: ${(e as Error).message}`);
    } finally {
      setTesting(false);
    }
  };
  useEffect(() => {
    backend.getP6().then(setList).catch((e) => setMsg(e.message));
  }, [backend]);
  if (!backend.caps.p6) return <p className="muted">Connecting to P6 needs the Stratum desktop app or a Stratum Server. In the browser, exchange data with P6 through XER files (Import schedule / Export → P6 XER).</p>;
  const canEdit = backend.kind !== "server" || backend.user?.role === "admin";

  const save = async (next: P6Connection[]) => {
    await backend.setP6(next);
    setList(await backend.getP6());
  };

  return (
    <div className="stack">
      <p className="muted">
        Pull projects from P6 into Stratum. EPPM connections can also push progress (actual dates, % complete, remaining duration) back. P6 Professional databases are read-only: send changes back with an XER.
      </p>
      <ul className="list">
        {list.map((c) => (
          <li key={c.id}>
            <b>{c.name}</b> · {KIND_LABEL[c.kind]}{" "}
            {canEdit && (
              <>
                <button className="link" onClick={() => setEdit(c)}>
                  edit
                </button>
                <button className="link" onClick={() => save(list.filter((x) => x.id !== c.id))}>
                  remove
                </button>
              </>
            )}
            <button className="link" disabled={testing} onClick={() => runTest(c)}>
              test
            </button>
          </li>
        ))}
      </ul>
      {list.length === 0 && <p className="muted">No connections yet.</p>}
      {canEdit && !edit && (
        <button onClick={() => setEdit({ id: uid("p6"), name: "Company P6", kind: "eppm", auth: "session", url: "", database: "", user: "", password: "" })}>+ Add connection</button>
      )}
      {edit && (
        <section className="stack form">
          <label>
            Name
            <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          </label>
          <label>
            Type
            <select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value as P6ConnectionKind, schema: e.target.value === "p6-sqlserver" ? "dbo" : e.target.value === "p6-oracle" ? "ADMUSER" : undefined })}>
              {(Object.keys(KIND_LABEL) as P6ConnectionKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          {edit.kind === "eppm" && (
            <>
              <label>
                REST API address
                <input value={edit.url ?? ""} onChange={(e) => setEdit({ ...edit, url: e.target.value })} placeholder="https://p6.company.com/p6ws/restapi" />
              </label>
              <label>
                Database name (as on the P6 login page)
                <input value={edit.database ?? ""} onChange={(e) => setEdit({ ...edit, database: e.target.value })} placeholder="PMDB" />
              </label>
              <label>
                Sign-in
                <select value={edit.auth ?? "session"} onChange={(e) => setEdit({ ...edit, auth: e.target.value as "session" | "bearer" })}>
                  <option value="session">P6 username and password</option>
                  <option value="bearer">OAuth token (Oracle-hosted P6)</option>
                </select>
              </label>
              {edit.auth === "bearer" ? (
                <label>
                  Token
                  <input type="password" value={edit.token ?? ""} onChange={(e) => setEdit({ ...edit, token: e.target.value })} />
                </label>
              ) : (
                <UserPass edit={edit} setEdit={setEdit} />
              )}
              <details className="cert-box" open={!!edit.caCert}>
                <summary>Company certificate (optional)</summary>
                <p className="muted">
                  Only needed if the P6 server uses a certificate from your company's own authority and it isn't installed on {backend.kind === "desktop" ? "this PC" : "the Stratum Server"}. Paste the root certificate (PEM text starting with -----BEGIN CERTIFICATE-----). IT can export it from the browser's padlock → certificate → root → export as Base-64.
                </p>
                <textarea rows={4} value={edit.caCert ?? ""} onChange={(e) => setEdit({ ...edit, caCert: e.target.value || undefined })} placeholder="-----BEGIN CERTIFICATE-----" spellCheck={false} />
                {edit.caCert && !/-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/.test(edit.caCert) && <p className="bad">That doesn't look like a PEM certificate.</p>}
              </details>
            </>
          )}
          {(edit.kind === "p6-sqlserver" || edit.kind === "p6-oracle") && (
            <>
              <div className="row">
                <label style={{ flex: 2 }}>
                  Host
                  <input value={edit.host ?? ""} onChange={(e) => setEdit({ ...edit, host: e.target.value })} placeholder="p6db.company.local" />
                </label>
                <label style={{ flex: 1 }}>
                  Port
                  <input type="number" value={edit.port ?? (edit.kind === "p6-oracle" ? 1521 : 1433)} onChange={(e) => setEdit({ ...edit, port: Number(e.target.value) })} />
                </label>
              </div>
              <div className="row">
                <label style={{ flex: 2 }}>
                  {edit.kind === "p6-oracle" ? "Service name" : "Database"}
                  <input value={edit.service ?? ""} onChange={(e) => setEdit({ ...edit, service: e.target.value })} placeholder={edit.kind === "p6-oracle" ? "PMDB" : "PMDB"} />
                </label>
                <label style={{ flex: 1 }}>
                  Schema / owner
                  <input value={edit.schema ?? ""} onChange={(e) => setEdit({ ...edit, schema: e.target.value })} />
                </label>
              </div>
              <UserPass edit={edit} setEdit={setEdit} />
              <p className="muted">Use a read-only database login. Stratum only runs SELECT queries.</p>
            </>
          )}
          {edit.kind === "p6-sqlite" && (
            <label>
              Path to the P6 Professional database file
              <input value={edit.file ?? ""} onChange={(e) => setEdit({ ...edit, file: e.target.value })} placeholder="C:\\Users\\you\\Documents\\Oracle\\Primavera P6\\P6 Professional\\PPMDBSQLite.db" />
            </label>
          )}
          <div className="row">
            <button
              className="primary"
              onClick={async () => {
                const next = list.some((x) => x.id === edit.id) ? list.map((x) => (x.id === edit.id ? edit : x)) : [...list, edit];
                await save(next);
                setEdit(null);
              }}
            >
              Save
            </button>
            <button disabled={testing} onClick={() => runTest(edit)}>
              {testing ? "Checking…" : "Test connection"}
            </button>
            <button onClick={() => setEdit(null)}>Cancel</button>
          </div>
        </section>
      )}
      {testing && <p className="muted">Checking the connection step by step…</p>}
      {diag && <DiagnosisView name={diag.name} d={diag.d} />}
      {msg && <p className={/fail|error|cannot|refused|not found|denied|401|403/i.test(msg) ? "bad" : "good"}>{msg}</p>}
    </div>
  );
}

const STEP_ICON: Record<CheckStep["status"], string> = { ok: "✓", warn: "!", fail: "✕", skip: "–" };

function DiagnosisView({ name, d }: { name: string; d: P6Diagnosis }) {
  const [copied, setCopied] = useState(false);
  const report = () =>
    [`Stratum 4D connection check: ${name}`, `Result: ${d.summary}`, "", ...d.steps.map((s) => `[${s.status.toUpperCase()}] ${s.label}: ${s.detail}${s.hint ? `\n       → ${s.hint}` : ""}`)].join("\n");
  return (
    <div className={`diag ${d.ok ? "diag-ok" : "diag-bad"}`}>
      <div className="diag-head">
        <b>{d.ok ? "Connection works" : "Connection failed"}</b>
        <span className="spacer" />
        <button
          className="link"
          onClick={() => {
            void navigator.clipboard?.writeText(report()).then(() => setCopied(true));
          }}
        >
          {copied ? "Copied" : "Copy report for IT"}
        </button>
      </div>
      <ol className="diag-steps">
        {d.steps.map((s) => (
          <li key={s.id} className={`step-${s.status}`}>
            <span className="step-icon" aria-label={s.status}>
              {STEP_ICON[s.status]}
            </span>
            <div>
              <div>
                <b>{s.label}</b> <span className="muted">{s.detail}</span>
              </div>
              {s.hint && <div className="step-hint">{s.hint}</div>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function UserPass({ edit, setEdit }: { edit: P6Connection; setEdit: (c: P6Connection) => void }) {
  return (
    <div className="row">
      <label style={{ flex: 1 }}>
        Username
        <input value={edit.user ?? ""} onChange={(e) => setEdit({ ...edit, user: e.target.value })} autoComplete="off" />
      </label>
      <label style={{ flex: 1 }}>
        Password
        <input type="password" value={edit.password ?? ""} onChange={(e) => setEdit({ ...edit, password: e.target.value })} autoComplete="new-password" />
      </label>
    </div>
  );
}

const PRESETS: { label: string; s: Partial<SmtpSettings> }[] = [
  { label: "Office 365 / Outlook", s: { host: "smtp.office365.com", port: 587, secure: false } },
  { label: "Gmail", s: { host: "smtp.gmail.com", port: 587, secure: false } },
  { label: "Other (TLS 465)", s: { port: 465, secure: true } },
];

function EmailTab() {
  const { backend } = useConfig();
  const [s, setS] = useState<SmtpSettings>({ host: "", port: 587, secure: false, user: "", password: "", from: "" });
  const [to, setTo] = useState("");
  const [msg, setMsg] = useState("");
  useEffect(() => {
    backend
      .getSmtp()
      .then((x) => x && setS(x))
      .catch(() => {});
  }, [backend]);
  if (!backend.caps.email) return <p className="muted">Email needs the Stratum desktop app or a Stratum Server.</p>;
  const canEdit = backend.kind !== "server" || backend.user?.role === "admin";
  return (
    <div className="stack">
      <p className="muted">
        Scheduled reports are sent through your mail server.{" "}
        {backend.caps.alwaysOn ? "The server sends them on schedule around the clock." : "The desktop app sends them while it is open; anything missed goes out when you next start it."}
      </p>
      <div className="row wrap">
        {PRESETS.map((p) => (
          <button key={p.label} onClick={() => setS({ ...s, ...p.s })} disabled={!canEdit}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="row">
        <label style={{ flex: 2 }}>
          SMTP server
          <input value={s.host} onChange={(e) => setS({ ...s, host: e.target.value })} disabled={!canEdit} />
        </label>
        <label style={{ flex: 1 }}>
          Port
          <input type="number" value={s.port} onChange={(e) => setS({ ...s, port: Number(e.target.value) })} disabled={!canEdit} />
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={s.secure} onChange={(e) => setS({ ...s, secure: e.target.checked })} disabled={!canEdit} /> TLS from the start (port 465). Leave off for STARTTLS on 587.
      </label>
      <div className="row">
        <label style={{ flex: 1 }}>
          Username
          <input value={s.user} onChange={(e) => setS({ ...s, user: e.target.value })} disabled={!canEdit} autoComplete="off" />
        </label>
        <label style={{ flex: 1 }}>
          Password / app password
          <input type="password" value={s.password} onChange={(e) => setS({ ...s, password: e.target.value })} disabled={!canEdit} autoComplete="new-password" />
        </label>
      </div>
      <label>
        Send as (From)
        <input value={s.from} onChange={(e) => setS({ ...s, from: e.target.value })} placeholder="planning@yourcompany.com" disabled={!canEdit} />
      </label>
      <div className="row">
        <button
          className="primary"
          disabled={!canEdit}
          onClick={async () => {
            try {
              await backend.setSmtp(s);
              setMsg("Saved.");
            } catch (e) {
              setMsg((e as Error).message);
            }
          }}
        >
          Save
        </button>
        <input placeholder="Send a test to…" value={to} onChange={(e) => setTo(e.target.value)} style={{ flex: 1 }} />
        <button
          onClick={async () => {
            setMsg("Testing…");
            try {
              setMsg(await backend.testSmtp(s, to || undefined));
            } catch (e) {
              setMsg((e as Error).message);
            }
          }}
        >
          Test
        </button>
      </div>
      {msg && <p className={/fail|error|invalid|refused|timeout|auth/i.test(msg) ? "bad" : "good"}>{msg}</p>}
    </div>
  );
}

function UsersTab() {
  const backend = useConfig((s) => s.backend) as ReturnType<typeof serverBackend>;
  const [users, setUsers] = useState<(SessionUser & { id: string })[]>([]);
  const [edit, setEdit] = useState<{ id: string; email: string; name: string; role: string; password: string } | null>(null);
  const [msg, setMsg] = useState("");
  const load = () =>
    backend
      .listUsers()
      .then((u) => setUsers(u as never))
      .catch((e) => setMsg(e.message));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="stack">
      <table className="data">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.name}</td>
              <td>{u.email}</td>
              <td>{u.role}</td>
              <td>
                <button className="link" onClick={() => setEdit({ id: u.id, email: u.email, name: u.name, role: u.role, password: "" })}>
                  edit
                </button>
                <button
                  className="link"
                  onClick={async () => {
                    try {
                      await backend.deleteUser(u.id);
                      load();
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
      <p className="muted">Admins manage users and settings; planners edit projects, dashboards and reports; viewers read and receive reports.</p>
      {!edit && <button onClick={() => setEdit({ id: uid("usr"), email: "", name: "", role: "planner", password: "" })}>+ Add user</button>}
      {edit && (
        <section className="stack form">
          <div className="row">
            <label style={{ flex: 1 }}>
              Name
              <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </label>
            <label style={{ flex: 1 }}>
              Email
              <input value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} />
            </label>
          </div>
          <div className="row">
            <label style={{ flex: 1 }}>
              Role
              <select value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })}>
                <option value="admin">Admin</option>
                <option value="planner">Planner</option>
                <option value="viewer">Viewer</option>
              </select>
            </label>
            <label style={{ flex: 1 }}>
              Password {users.some((u) => u.id === edit.id) ? "(leave blank to keep)" : ""}
              <input type="password" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} autoComplete="new-password" />
            </label>
          </div>
          <div className="row">
            <button
              className="primary"
              onClick={async () => {
                try {
                  await backend.saveUser(edit.id, { email: edit.email, name: edit.name, role: edit.role, password: edit.password || undefined });
                  setEdit(null);
                  load();
                } catch (e) {
                  setMsg((e as Error).message);
                }
              }}
            >
              Save
            </button>
            <button onClick={() => setEdit(null)}>Cancel</button>
          </div>
        </section>
      )}
      {msg && <p className="bad">{msg}</p>}
    </div>
  );
}
