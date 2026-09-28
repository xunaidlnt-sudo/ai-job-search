"""Approval workflow: a submitted document walks through its document type's
steps in order. Each approval stamps that approver's signature at the step's
placeholder and saves a new version of the file, so the document fills up
with signatures as it moves along. Every version is hashed and logged.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from . import stamper
from .config import AppConfig, ConfigError, DocumentType, Step
from .signatures import SignatureStore

SCHEMA = """
CREATE TABLE IF NOT EXISTS requests (
    id TEXT PRIMARY KEY,
    doc_type TEXT NOT NULL,
    title TEXT NOT NULL,
    filename TEXT NOT NULL,
    submitter TEXT NOT NULL,
    assignments TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL,            -- pending | approved | rejected | cancelled
    current_step TEXT,
    version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT NOT NULL REFERENCES requests(id),
    step_id TEXT,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,            -- submitted | approved | rejected | cancelled
    comment TEXT NOT NULL DEFAULT '',
    version INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    at TEXT NOT NULL
);
"""


class WorkflowError(Exception):
    pass


class NotAllowed(WorkflowError):
    pass


@dataclass
class Request:
    id: str
    doc_type: str
    title: str
    filename: str
    submitter: str
    assignments: dict[str, str]
    status: str
    current_step: str | None
    version: int
    created_at: str
    updated_at: str


def _now() -> datetime:
    return datetime.now(timezone.utc)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class WorkflowEngine:
    def __init__(self, cfg: AppConfig, data_dir: str | Path, notifier=None):
        self.cfg = cfg
        self.data_dir = Path(data_dir)
        self.docs_dir = self.data_dir / "documents"
        self.docs_dir.mkdir(parents=True, exist_ok=True)
        self.signatures = SignatureStore(cfg, self.data_dir / "signatures")
        self.notifier = notifier
        self.db_path = self.data_dir / "autosign.db"
        with self._db() as db:
            db.executescript(SCHEMA)

    @contextmanager
    def _db(self, write: bool = False):
        db = sqlite3.connect(self.db_path, timeout=30)
        db.row_factory = sqlite3.Row
        try:
            if write:
                # Take the write lock up front: two people clicking Approve on
                # the same step at once must not both get through.
                db.execute("BEGIN IMMEDIATE")
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    # ------------------------------------------------------------ storage

    def _file(self, request_id: str, version: int, filename: str) -> Path:
        return self.docs_dir / request_id / f"v{version}{Path(filename).suffix.lower()}"

    def document(self, request_id: str, version: int | None = None) -> tuple[bytes, str]:
        """Bytes and download name of a version (latest by default)."""
        req = self.get(request_id)
        v = req.version if version is None else version
        if not 0 <= v <= req.version:
            raise WorkflowError(f"version {v} does not exist")
        path = self._file(req.id, v, req.filename)
        stem = Path(req.filename).stem
        suffix = path.suffix
        name = f"{stem}{suffix}" if v == 0 else f"{stem}_signed_v{v}{suffix}"
        return path.read_bytes(), name

    def _row(self, row) -> Request:
        d = dict(row)
        d["assignments"] = json.loads(d["assignments"])
        return Request(**d)

    def get(self, request_id: str) -> Request:
        with self._db() as db:
            row = db.execute("SELECT * FROM requests WHERE id = ?", (request_id,)).fetchone()
        if not row:
            raise WorkflowError(f"request {request_id} not found")
        return self._row(row)

    def list(self, status: str | None = None) -> list[Request]:
        sql, args = "SELECT * FROM requests", ()
        if status:
            sql, args = sql + " WHERE status = ?", (status,)
        with self._db() as db:
            rows = db.execute(sql + " ORDER BY created_at DESC", args).fetchall()
        return [self._row(r) for r in rows]

    def history(self, request_id: str) -> list[dict]:
        with self._db() as db:
            rows = db.execute("SELECT * FROM events WHERE request_id = ? ORDER BY id", (request_id,)).fetchall()
        return [dict(r) for r in rows]

    # ------------------------------------------------------------ rules

    def eligible(self, req: Request, step: Step) -> list[str]:
        """User ids allowed to approve this step of this request."""
        if step.id in req.assignments:
            return [req.assignments[step.id]]
        if step.user:
            return [step.user]
        if step.role:
            return [u.id for u in self.cfg.users_with_role(step.role)]
        return []

    def can_approve(self, req: Request, user_id: str) -> bool:
        if req.status != "pending" or not req.current_step:
            return False
        dt = self.cfg.doc_type(req.doc_type)
        if user_id not in self.eligible(req, dt.step(req.current_step)):
            return False
        if dt.distinct_approvers:
            signed = {e["actor"] for e in self.history(req.id) if e["action"] == "approved"}
            if user_id in signed:
                return False
        return True

    def pending_for(self, user_id: str) -> list[Request]:
        return [r for r in self.list("pending") if self.can_approve(r, user_id)]

    # ------------------------------------------------------------ actions

    def submit(self, doc_type_id: str, title: str, filename: str, data: bytes, submitter: str,
               assignments: dict[str, str] | None = None) -> Request:
        dt = self.cfg.doc_type(doc_type_id)
        self.cfg.user(submitter)
        stamper.doc_kind(filename)
        assignments = {k: v for k, v in (assignments or {}).items() if v}
        for step in dt.steps:
            chosen = assignments.get(step.id)
            if step.assignable and not chosen and not (step.role or step.user):
                raise WorkflowError(f"choose an approver for '{step.label}'")
            if chosen:
                if not step.assignable:
                    raise WorkflowError(f"'{step.label}' does not take a chosen approver")
                user = self.cfg.user(chosen)
                if step.role and step.role not in user.roles:
                    raise WorkflowError(f"{user.name} does not have role '{step.role}' needed for '{step.label}'")

        # Catch a wrong template now rather than at the final approval.
        missing = stamper.missing_placeholders(stamper.check_placeholders(data, filename, dt), dt)
        if missing:
            raise WorkflowError("placeholders missing for: " + ", ".join(missing))

        req_id = uuid.uuid4().hex[:12]
        now = _now().isoformat(timespec="seconds")
        path = self._file(req_id, 0, filename)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        with self._db(write=True) as db:
            db.execute(
                "INSERT INTO requests VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (req_id, dt.id, title or Path(filename).stem, Path(filename).name, submitter,
                 json.dumps(assignments), "pending", dt.steps[0].id, 0, now, now),
            )
            db.execute(
                "INSERT INTO events (request_id, step_id, actor, action, version, sha256, at) VALUES (?,?,?,?,?,?,?)",
                (req_id, None, submitter, "submitted", 0, sha256(data), now),
            )
        req = self.get(req_id)
        self._notify_next(req)
        return req

    def approve(self, request_id: str, user_id: str, comment: str = "", step_id: str | None = None) -> Request:
        """Stamp the approver's signature for the current step and move on.

        `step_id`, when given, must match the current step - it stops an old
        email link or a retried webhook from signing a later step by mistake."""
        with self._db(write=True) as db:
            row = db.execute("SELECT * FROM requests WHERE id = ?", (request_id,)).fetchone()
            if not row:
                raise WorkflowError(f"request {request_id} not found")
            req = self._row(row)
            if req.status != "pending":
                raise WorkflowError(f"request is already {req.status}")
            if step_id and step_id != req.current_step:
                raise WorkflowError(f"step '{step_id}' is not the step awaiting approval")
            if not self.can_approve(req, user_id):
                raise NotAllowed(f"{user_id} cannot approve this step")

            dt = self.cfg.doc_type(req.doc_type)
            step = dt.step(req.current_step)
            user = self.cfg.user(user_id)
            now = _now()
            data = self._file(req.id, req.version, req.filename).read_bytes()
            signer = stamper.Signer(name=user.name, designation=user.designation, email=user.email,
                                    step_label=step.label, when=now.astimezone())
            signed = stamper.sign_step(data, req.filename, step,
                                       lambda variant: self.signatures.get(user_id, variant), signer)

            idx = [s.id for s in dt.steps].index(step.id)
            next_step = dt.steps[idx + 1].id if idx + 1 < len(dt.steps) else None
            version = req.version + 1
            filename = req.filename
            events = [(step.id, user_id, "approved", comment, version, sha256(signed))]

            if next_step is None:
                signed, filename = self._finalise(dt, req, signed, events, now)

            path = self._file(req.id, version, filename)
            path.write_bytes(signed)
            ts = now.isoformat(timespec="seconds")
            db.execute(
                "UPDATE requests SET status=?, current_step=?, version=?, filename=?, updated_at=? WHERE id=?",
                ("approved" if next_step is None else "pending", next_step, version, filename, ts, req.id),
            )
            for ev in events:
                db.execute(
                    "INSERT INTO events (request_id, step_id, actor, action, comment, version, sha256, at)"
                    " VALUES (?,?,?,?,?,?,?,?)", (req.id, *ev, ts),
                )
        req = self.get(request_id)
        if req.status == "approved":
            self._notify(req, "completed")
        else:
            self._notify_next(req)
        return req

    def _finalise(self, dt: DocumentType, req: Request, signed: bytes, events: list, now: datetime):
        """Last approval: optional DOCX->PDF conversion and certificate page."""
        filename = req.filename
        if dt.output_pdf and stamper.doc_kind(filename) == "docx":
            signed = stamper.docx_to_pdf(signed)
            filename = str(Path(filename).with_suffix(".pdf"))
        if dt.append_audit_page and stamper.doc_kind(filename) == "pdf":
            lines = [f"Document: {req.title}", f"Type: {dt.name}", f"Request ID: {req.id}", ""]
            for e in self.history(req.id):
                lines.append(self._audit_line(e))
            lines.append(self._audit_line({"at": now.isoformat(timespec="seconds"), "action": events[0][2],
                                           "actor": events[0][1], "step_id": events[0][0],
                                           "sha256": events[0][5]}))
            lines += ["", "Each SHA-256 identifies the file produced at that step. The hash of this final",
                      "file (with this page) is kept in the system's event log."]
            signed = stamper.append_audit_page(signed, "Approval record", lines)
        # The event must carry the hash of the file actually saved.
        step_id, actor, action, comment, version, _ = events[0]
        events[0] = (step_id, actor, action, comment, version, sha256(signed))
        return signed, filename

    def _audit_line(self, e: dict) -> str:
        user = self.cfg.users.get(e["actor"])
        who = f"{user.name} ({user.designation})" if user and user.designation else (user.name if user else e["actor"])
        what = e["action"] + (f" - {e['step_id']}" if e.get("step_id") else "")
        return f"{e['at']}  {what}  by {who}\n    sha256 {e['sha256']}"

    def reject(self, request_id: str, user_id: str, comment: str, step_id: str | None = None) -> Request:
        with self._db(write=True) as db:
            row = db.execute("SELECT * FROM requests WHERE id = ?", (request_id,)).fetchone()
            if not row:
                raise WorkflowError(f"request {request_id} not found")
            req = self._row(row)
            if step_id and step_id != req.current_step:
                raise WorkflowError(f"step '{step_id}' is not the step awaiting approval")
            if not self.can_approve(req, user_id):
                raise NotAllowed(f"{user_id} cannot act on this step")
            data = self._file(req.id, req.version, req.filename).read_bytes()
            ts = _now().isoformat(timespec="seconds")
            db.execute("UPDATE requests SET status='rejected', updated_at=? WHERE id=?", (ts, req.id))
            db.execute(
                "INSERT INTO events (request_id, step_id, actor, action, comment, version, sha256, at)"
                " VALUES (?,?,?,?,?,?,?,?)",
                (req.id, req.current_step, user_id, "rejected", comment, req.version, sha256(data), ts),
            )
        req = self.get(request_id)
        self._notify(req, "rejected", comment=comment, actor=user_id)
        return req

    def cancel(self, request_id: str, user_id: str, comment: str) -> Request:
        """Admin (or the submitter) withdraws a pending request."""
        user = self.cfg.user(user_id)
        with self._db(write=True) as db:
            row = db.execute("SELECT * FROM requests WHERE id = ?", (request_id,)).fetchone()
            if not row:
                raise WorkflowError(f"request {request_id} not found")
            req = self._row(row)
            if req.status != "pending":
                raise WorkflowError(f"request is already {req.status}")
            if not (user.admin or req.submitter == user_id):
                raise NotAllowed("only an admin or the submitter can cancel")
            data = self._file(req.id, req.version, req.filename).read_bytes()
            ts = _now().isoformat(timespec="seconds")
            db.execute("UPDATE requests SET status='cancelled', updated_at=? WHERE id=?", (ts, req.id))
            db.execute(
                "INSERT INTO events (request_id, step_id, actor, action, comment, version, sha256, at)"
                " VALUES (?,?,?,?,?,?,?,?)",
                (req.id, req.current_step, user_id, "cancelled", comment, req.version, sha256(data), ts),
            )
        return self.get(request_id)

    # ------------------------------------------------------------ notifications

    def _notify_next(self, req: Request) -> None:
        if not self.notifier or req.status != "pending":
            return
        dt = self.cfg.doc_type(req.doc_type)
        step = dt.step(req.current_step)
        for uid in self.eligible(req, step):
            if self.can_approve(req, uid):
                self.notifier.approval_needed(req, dt, step, self.cfg.user(uid))

    def _notify(self, req: Request, event: str, **extra) -> None:
        if not self.notifier:
            return
        try:
            submitter = self.cfg.user(req.submitter)
        except ConfigError:
            return
        self.notifier.status_changed(req, self.cfg.doc_type(req.doc_type), submitter, event, **extra)
