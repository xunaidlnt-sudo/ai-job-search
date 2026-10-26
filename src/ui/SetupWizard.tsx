// First-run setup: interface mode, where data lives, optional P6 and email.
// Everything here can be changed later in Settings.

import { useState } from "react";
import { isDesktop, useConfig } from "../backend/config";
import { serverLogin, serverSetup, serverStatus } from "../backend/server";
import type { InterfaceMode } from "../core/reporting";
import { MODE_INFO } from "./terms";

type Step = "mode" | "storage" | "done";

export function SetupWizard({ onDone }: { onDone: (openSettings?: "p6" | "email") => void }) {
  const { config, update } = useConfig();
  const [step, setStep] = useState<Step>("mode");
  const [mode, setMode] = useState<InterfaceMode>(config.mode);
  const [storage, setStorage] = useState<"local" | "server">(config.storage);
  const [url, setUrl] = useState(config.serverUrl || (location.protocol.startsWith("http") ? location.origin : ""));
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const desktop = isDesktop();

  const checkServer = async () => {
    setBusy(true);
    setMsg("");
    try {
      const st = await serverStatus(url);
      setNeedsSetup(st.needsSetup);
      update({ serverPdf: st.pdf });
      setMsg(st.needsSetup ? "New server: create the first administrator account." : "Server found. Sign in.");
    } catch (e) {
      setNeedsSetup(null);
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const connect = async () => {
    setBusy(true);
    setMsg("");
    try {
      const r = needsSetup ? await serverSetup(url, email, name, password) : await serverLogin(url, email, password);
      update({ storage: "server", serverUrl: url, token: r.token, user: r.user });
      setStep("done");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const finish = (open?: "p6" | "email") => {
    update({ configured: true, mode });
    onDone(open);
  };

  return (
    <div className="help-backdrop">
      <div className="help wizard" role="dialog" aria-label="Set up Stratum">
        <img src="./stratum-logo.png" alt="Stratum 4D" className="help-logo logo-light" />
        <img src="./stratum-logo-dark.png" alt="" aria-hidden className="help-logo logo-dark" />
        {step === "mode" && (
          <>
            <h2>How do you like to work?</h2>
            <p className="muted">Pick the layout that feels familiar. The engine and your data are the same in all three, and you can switch any time in Settings.</p>
            <div className="mode-cards">
              {(Object.keys(MODE_INFO) as InterfaceMode[]).map((m) => (
                <button key={m} className={`mode-card ${mode === m ? "active" : ""}`} onClick={() => setMode(m)}>
                  <b>{MODE_INFO[m].title}</b>
                  <span className="muted">{MODE_INFO[m].blurb}</span>
                  <ul>
                    {MODE_INFO[m].points.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </button>
              ))}
            </div>
            <div className="row end">
              <button className="primary" onClick={() => setStep("storage")}>
                Next
              </button>
            </div>
          </>
        )}

        {step === "storage" && (
          <>
            <h2>Where should projects be stored?</h2>
            <div className="mode-cards two">
              <button className={`mode-card ${storage === "local" ? "active" : ""}`} onClick={() => setStorage("local")}>
                <b>On this {desktop ? "computer" : "browser"}</b>
                <span className="muted">
                  {desktop
                    ? "A local database file in your profile. Works offline. Scheduled reports go out while Stratum is open."
                    : "Saved in this browser only. For P6 connections and emailed reports, use the desktop app or a Stratum Server."}
                </span>
              </button>
              <button className={`mode-card ${storage === "server" ? "active" : ""}`} onClick={() => setStorage("server")}>
                <b>Stratum Server (shared)</b>
                <span className="muted">One database for the whole team, with sign-in and roles. Reports are emailed on schedule even when everyone's PC is off.</span>
              </button>
            </div>
            {storage === "server" && (
              <div className="stack server-form">
                <label>
                  Server address
                  <div className="row">
                    <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://stratum.yourcompany.com" style={{ flex: 1 }} />
                    <button onClick={checkServer} disabled={!url || busy}>
                      Check
                    </button>
                  </div>
                </label>
                {needsSetup !== null && (
                  <>
                    {needsSetup && (
                      <label>
                        Your name
                        <input value={name} onChange={(e) => setName(e.target.value)} />
                      </label>
                    )}
                    <label>
                      Email
                      <input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
                    </label>
                    <label>
                      Password{needsSetup ? " (at least 8 characters)" : ""}
                      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={needsSetup ? "new-password" : "current-password"} />
                    </label>
                  </>
                )}
              </div>
            )}
            {msg && <p className={/error|cannot|wrong|invalid|failed/i.test(msg) ? "bad" : "muted"}>{msg}</p>}
            <div className="row end">
              <button onClick={() => setStep("mode")}>Back</button>
              {storage === "local" ? (
                <button
                  className="primary"
                  onClick={() => {
                    update({ storage: "local" });
                    setStep("done");
                  }}
                >
                  Next
                </button>
              ) : (
                <button className="primary" disabled={needsSetup === null || !email || !password || busy} onClick={connect}>
                  {needsSetup ? "Create admin and connect" : "Sign in"}
                </button>
              )}
            </div>
          </>
        )}

        {step === "done" && (
          <>
            <h2>Ready</h2>
            <p>
              {MODE_INFO[mode].title} · {useConfig.getState().backend.label}
            </p>
            {useConfig.getState().backend.caps.p6 ? (
              <p className="muted">You can connect to Primavera P6 (EPPM or a P6 Professional database) and set up email for scheduled reports now, or later from Settings.</p>
            ) : (
              <p className="muted">P6 connections and emailed reports need the desktop app or a Stratum Server. Everything else works here.</p>
            )}
            <div className="row end">
              {useConfig.getState().backend.caps.p6 && <button onClick={() => finish("p6")}>Connect to P6…</button>}
              {useConfig.getState().backend.caps.email && <button onClick={() => finish("email")}>Set up email…</button>}
              <button className="primary" onClick={() => finish()}>
                Start
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
