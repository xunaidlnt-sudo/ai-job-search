"""Flask app: the approval screens, signature upload, one-click email links,
and a small REST API so an existing workflow tool (Power Automate, SharePoint,
an ERP, n8n...) can trigger the signing on its own Approve button."""

from __future__ import annotations

import hmac
import io
import logging
import os
import secrets
from datetime import datetime
from functools import wraps
from pathlib import Path

from flask import (Flask, abort, flash, g, jsonify, redirect, render_template, request,
                   send_file, session, url_for)
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from werkzeug.security import check_password_hash

from . import stamper
from .config import ConfigError, load_config
from .notifier import ConsoleNotifier, SmtpNotifier
from .signatures import MissingSignature, clean_scan
from .workflow import NotAllowed, WorkflowEngine, WorkflowError

MAX_UPLOAD_MB = 25
DEMO_PASSWORD = "demo"
LINK_MAX_AGE = int(os.environ.get("AUTOSIGN_LINK_HOURS", "72")) * 3600
# When set, an email link only works for the addressee after they log in, so a
# forwarded email cannot be used by someone else to sign.
LINK_REQUIRES_LOGIN = os.environ.get("AUTOSIGN_LINK_REQUIRES_LOGIN", "0") == "1"


def create_app(config_dir: str | Path, data_dir: str | Path, secret_key: str | None = None,
               api_key: str | None = None, base_url: str | None = None) -> Flask:
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_MB * 1024 * 1024
    app.secret_key = secret_key or os.environ.get("AUTOSIGN_SECRET_KEY") or secrets.token_hex(32)
    api_key = api_key or os.environ.get("AUTOSIGN_API_KEY", "")
    base_url = (base_url or os.environ.get("AUTOSIGN_BASE_URL", "http://localhost:5000")).rstrip("/")

    cfg = load_config(config_dir)
    links = URLSafeTimedSerializer(app.secret_key, salt="autosign-approval-link")

    def link_for(request_id, step_id, user_id):
        return f"{base_url}/act/{links.dumps({'r': request_id, 's': step_id, 'u': user_id})}"

    def request_url(request_id):
        return f"{base_url}/requests/{request_id}"

    notifier_cls = SmtpNotifier if os.environ.get("AUTOSIGN_SMTP_HOST") else ConsoleNotifier
    engine = WorkflowEngine(cfg, data_dir, notifier_cls(link_for, request_url))
    app.extensions["autosign"] = engine
    app.extensions["autosign_links"] = link_for

    # Accounts still on the sample password are listed on the login page so
    # people can try the system. The list empties itself once passwords change.
    demo_accounts = [u for u in cfg.users.values()
                     if u.password_hash and check_password_hash(u.password_hash, DEMO_PASSWORD)]
    if demo_accounts:
        logging.getLogger("autosign").warning(
            "%d account(s) still use the demo password; they are listed on the login page", len(demo_accounts))

    # ------------------------------------------------------------ helpers

    @app.before_request
    def load_user():
        g.user = cfg.users.get(session.get("user"))
        if request.method == "POST" and not request.path.startswith("/api/"):
            sent = request.form.get("csrf", "")
            if not sent or not hmac.compare_digest(sent, session.get("csrf", "")):
                abort(400, "form expired - reload the page and try again")

    @app.context_processor
    def inject():
        if "csrf" not in session:
            session["csrf"] = secrets.token_hex(16)
        return {"me": g.get("user"), "csrf": session["csrf"], "cfg": cfg}

    def login_required(fn):
        @wraps(fn)
        def wrapper(*a, **kw):
            if not g.user:
                return redirect(url_for("login", next=request.path))
            return fn(*a, **kw)
        return wrapper

    def admin_required(fn):
        @wraps(fn)
        def wrapper(*a, **kw):
            if not g.user:
                return redirect(url_for("login", next=request.path))
            if not g.user.admin:
                abort(403)
            return fn(*a, **kw)
        return wrapper

    def can_view(req, user):
        if user.admin or req.submitter == user.id:
            return True
        dt = cfg.doc_type(req.doc_type)
        if any(user.id in engine.eligible(req, s) for s in dt.steps):
            return True
        return any(e["actor"] == user.id for e in engine.history(req.id))

    def load_request(request_id):
        try:
            req = engine.get(request_id)
        except WorkflowError:
            abort(404)
        if not can_view(req, g.user):
            abort(403)
        return req

    def steps_view(req):
        dt = cfg.doc_type(req.doc_type)
        done = {e["step_id"]: e for e in engine.history(req.id) if e["action"] in ("approved", "rejected")}
        rows = []
        for s in dt.steps:
            ev = done.get(s.id)
            who = ", ".join(cfg.users[u].name for u in engine.eligible(req, s) if u in cfg.users)
            state = ev["action"] if ev else ("waiting" if s.id == req.current_step and req.status == "pending" else "")
            rows.append({"step": s, "event": ev, "who": who, "state": state,
                         "actor": cfg.users[ev["actor"]].name if ev and ev["actor"] in cfg.users else ""})
        return rows

    def send_doc(req, version=None, inline=False):
        data, name = engine.document(req.id, version)
        mime = "application/pdf" if name.lower().endswith(".pdf") else \
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        return send_file(io.BytesIO(data), mimetype=mime, download_name=name, as_attachment=not inline)

    # ------------------------------------------------------------ pages

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if request.method == "POST":
            user = cfg.users.get(request.form.get("user", "").strip())
            if user and user.password_hash and check_password_hash(user.password_hash, request.form.get("password", "")):
                session.clear()
                session["user"] = user.id
                nxt = request.args.get("next", "")
                return redirect(nxt if nxt.startswith("/") and not nxt.startswith("//") else url_for("dashboard"))
            flash("Wrong user name or password.", "error")
        return render_template("login.html", demo_accounts=demo_accounts, demo_password=DEMO_PASSWORD)

    @app.post("/logout")
    def logout():
        session.clear()
        return redirect(url_for("login"))

    @app.get("/")
    @login_required
    def dashboard():
        mine = [r for r in engine.list() if r.submitter == g.user.id]
        pending = engine.pending_for(g.user.id)
        others = [r for r in engine.list() if g.user.admin and r.submitter != g.user.id]
        return render_template("dashboard.html", pending=pending, mine=mine, others=others)

    @app.route("/requests/new", methods=["GET", "POST"])
    @login_required
    def new_request():
        if request.method == "POST":
            f = request.files.get("file")
            dt_id = request.form.get("doc_type", "")
            try:
                if not f or not f.filename:
                    raise WorkflowError("choose a PDF or Word file")
                dt = cfg.doc_type(dt_id)
                assignments = {s.id: request.form.get(f"assign_{s.id}", "") for s in dt.steps if s.assignable}
                req = engine.submit(dt_id, request.form.get("title", "").strip(), f.filename, f.read(),
                                    g.user.id, assignments)
                flash("Submitted. The first approver has been notified.", "ok")
                return redirect(url_for("request_detail", request_id=req.id))
            except (WorkflowError, ConfigError, stamper.UnsupportedDocument) as e:
                flash(str(e), "error")
        return render_template("new_request.html")

    @app.get("/requests/<request_id>")
    @login_required
    def request_detail(request_id):
        req = load_request(request_id)
        return render_template("request.html", req=req, dt=cfg.doc_type(req.doc_type), steps=steps_view(req),
                               history=engine.history(req.id), can_act=engine.can_approve(req, g.user.id),
                               is_pdf=req.filename.lower().endswith(".pdf"))

    @app.get("/requests/<request_id>/document")
    @login_required
    def request_document(request_id):
        req = load_request(request_id)
        version = request.args.get("version", type=int)
        try:
            return send_doc(req, version, inline=request.args.get("inline") == "1")
        except WorkflowError:
            abort(404)

    def _act(req, user_id, step_id=None):
        action = request.form.get("action")
        comment = request.form.get("comment", "").strip()
        try:
            if action == "approve":
                engine.approve(req.id, user_id, comment, step_id=step_id)
                flash("Approved - your signature has been placed on the document.", "ok")
            elif action == "reject":
                if not comment:
                    raise WorkflowError("please give a reason for rejecting")
                engine.reject(req.id, user_id, comment, step_id=step_id)
                flash("Rejected. The submitter has been told.", "ok")
            else:
                abort(400)
        except MissingSignature as e:
            flash(f"{e}. Upload your signature first (My signature).", "error")
        except stamper.PlaceholderNotFound as e:
            flash(f"Could not sign: {e}", "error")
        except (WorkflowError, NotAllowed) as e:
            flash(str(e), "error")

    @app.post("/requests/<request_id>/act")
    @login_required
    def request_act(request_id):
        req = load_request(request_id)
        _act(req, g.user.id, request.form.get("step") or None)
        return redirect(url_for("request_detail", request_id=req.id))

    # One-click link from the email. GET shows the page; only POST approves.
    @app.route("/act/<token>", methods=["GET", "POST"])
    def email_action(token):
        try:
            data = links.loads(token, max_age=LINK_MAX_AGE)
        except SignatureExpired:
            return render_template("message.html", title="Link expired",
                                   text="This approval link has expired. Log in to approve from your dashboard."), 410
        except BadSignature:
            abort(404)
        try:
            req = engine.get(data["r"])
        except WorkflowError:
            abort(404)
        user = cfg.users.get(data["u"])
        if not user:
            abort(404)
        if LINK_REQUIRES_LOGIN and (not g.user or g.user.id != user.id):
            return redirect(url_for("login", next=request.path))
        if request.method == "POST":
            _act(req, user.id, data["s"])
            req = engine.get(req.id)
        still_open = req.status == "pending" and req.current_step == data["s"] and engine.can_approve(req, user.id)
        return render_template("email_action.html", req=req, dt=cfg.doc_type(req.doc_type), user=user,
                               step=cfg.doc_type(req.doc_type).step(data["s"]), still_open=still_open,
                               token=token, is_pdf=req.filename.lower().endswith(".pdf"))

    @app.get("/act/<token>/document")
    def email_document(token):
        try:
            data = links.loads(token, max_age=LINK_MAX_AGE)
            req = engine.get(data["r"])
        except (BadSignature, WorkflowError):
            abort(404)
        return send_doc(req, inline=request.args.get("inline") == "1")

    @app.route("/signature", methods=["GET", "POST"])
    @login_required
    def signature():
        if request.method == "POST":
            f = request.files.get("file")
            variant = request.form.get("variant", "full").strip() or "full"
            try:
                if not f or not f.filename:
                    raise ValueError("choose an image file")
                engine.signatures.save(g.user.id, variant, f.read(), clean=request.form.get("clean") != "0")
                flash(f"Saved your '{variant}' signature.", "ok")
            except (ValueError, OSError) as e:
                flash(f"Could not use that image: {e}", "error")
            return redirect(url_for("signature"))
        return render_template("signature.html", variants=engine.signatures.variants(g.user.id))

    @app.get("/signature/<variant>.png")
    @login_required
    def signature_image(variant):
        try:
            data = engine.signatures.get(g.user.id, variant)
        except (MissingSignature, ValueError):
            abort(404)
        return send_file(io.BytesIO(data), mimetype="image/png")

    # ------------------------------------------------------------ admin

    @app.get("/admin")
    @admin_required
    def admin():
        status = request.args.get("status") or None
        everything = engine.list()
        counts = {s: sum(r.status == s for r in everything) for s in ("pending", "approved", "rejected", "cancelled")}
        users = [{"user": u, "variants": engine.signatures.variants(u.id),
                  "pending": len(engine.pending_for(u.id))} for u in cfg.users.values()]
        return render_template("admin.html", requests=engine.list(status), counts=counts, status=status,
                               total=len(everything), users=users, demo_accounts=demo_accounts)

    @app.post("/admin/requests/<request_id>/cancel")
    @admin_required
    def admin_cancel(request_id):
        try:
            engine.cancel(request_id, g.user.id, request.form.get("comment", "").strip() or "cancelled by admin")
            flash("Request cancelled.", "ok")
        except (WorkflowError, NotAllowed) as e:
            flash(str(e), "error")
        return redirect(request.referrer or url_for("admin"))

    @app.post("/admin/users/<user_id>/signature")
    @admin_required
    def admin_signature_upload(user_id):
        f = request.files.get("file")
        variant = request.form.get("variant", "full")
        try:
            if not f or not f.filename:
                raise ValueError("choose an image file")
            engine.signatures.save(user_id, variant, f.read(), clean=request.form.get("clean") != "0")
            flash(f"Saved '{variant}' signature for {cfg.user(user_id).name}.", "ok")
        except (ValueError, OSError, ConfigError) as e:
            flash(f"Could not use that image: {e}", "error")
        return redirect(url_for("admin") + "#users")

    @app.get("/admin/users/<user_id>/signature/<variant>.png")
    @admin_required
    def admin_signature_image(user_id, variant):
        try:
            data = engine.signatures.get(user_id, variant)
        except (MissingSignature, ValueError, ConfigError):
            abort(404)
        return send_file(io.BytesIO(data), mimetype="image/png")

    # ------------------------------------------------------------ REST API

    def api(fn):
        @wraps(fn)
        def wrapper(*a, **kw):
            sent = request.headers.get("X-API-Key", "")
            if not api_key or not hmac.compare_digest(sent, api_key):
                return jsonify(error="invalid or missing X-API-Key"), 401
            try:
                return fn(*a, **kw)
            except NotAllowed as e:
                return jsonify(error=str(e)), 403
            except MissingSignature as e:
                return jsonify(error=str(e)), 409
            except (WorkflowError, ConfigError, stamper.PlaceholderNotFound, stamper.UnsupportedDocument) as e:
                return jsonify(error=str(e)), 400
        return wrapper

    def req_json(req):
        return {"id": req.id, "title": req.title, "doc_type": req.doc_type, "status": req.status,
                "current_step": req.current_step, "version": req.version, "filename": req.filename,
                "submitter": req.submitter, "history": engine.history(req.id),
                "document_url": f"{base_url}/api/requests/{req.id}/document"}

    @app.post("/api/sign")
    @api
    def api_sign():
        """Stateless: sign one step of an uploaded file and return it. For
        workflow tools that keep their own approval state."""
        f = request.files.get("file")
        if not f:
            raise WorkflowError("multipart field 'file' is required")
        dt = cfg.doc_type(request.form.get("doc_type", ""))
        step = dt.step(request.form.get("step", ""))
        user = cfg.user(request.form.get("user", ""))
        signer = stamper.Signer(name=user.name, designation=user.designation, email=user.email,
                                step_label=step.label, when=datetime.now().astimezone())
        signed = stamper.sign_step(f.read(), f.filename, step,
                                   lambda variant: engine.signatures.get(user.id, variant), signer)
        return send_file(io.BytesIO(signed), download_name=f"{Path(f.filename).stem}_signed{Path(f.filename).suffix}",
                         as_attachment=True)

    @app.post("/api/requests")
    @api
    def api_submit():
        f = request.files.get("file")
        if not f:
            raise WorkflowError("multipart field 'file' is required")
        dt = cfg.doc_type(request.form.get("doc_type", ""))
        assignments = {s.id: request.form.get(f"assign_{s.id}", "") for s in dt.steps}
        req = engine.submit(dt.id, request.form.get("title", ""), f.filename, f.read(),
                            request.form.get("submitter", ""), assignments)
        return jsonify(req_json(req)), 201

    @app.get("/api/requests/<request_id>")
    @api
    def api_get(request_id):
        return jsonify(req_json(engine.get(request_id)))

    @app.get("/api/requests/<request_id>/document")
    @api
    def api_document(request_id):
        return send_doc(engine.get(request_id), request.args.get("version", type=int))

    @app.post("/api/requests/<request_id>/approve")
    @api
    def api_approve(request_id):
        body = request.get_json(silent=True) or {}
        req = engine.approve(request_id, body.get("user", ""), body.get("comment", ""), step_id=body.get("step"))
        return jsonify(req_json(req))

    @app.post("/api/requests/<request_id>/reject")
    @api
    def api_reject(request_id):
        body = request.get_json(silent=True) or {}
        req = engine.reject(request_id, body.get("user", ""), body.get("comment", ""), step_id=body.get("step"))
        return jsonify(req_json(req))

    @app.get("/healthz")
    def healthz():
        return {"ok": True}

    return app


def main():  # pragma: no cover - used by `python -m autosign.web`
    logging.basicConfig(level=logging.INFO)
    root = Path(__file__).resolve().parent.parent
    app = create_app(os.environ.get("AUTOSIGN_CONFIG", root / "config"),
                     os.environ.get("AUTOSIGN_DATA", root / "data"))
    app.run(host=os.environ.get("AUTOSIGN_HOST", "127.0.0.1"), port=int(os.environ.get("AUTOSIGN_PORT", "5000")))


if __name__ == "__main__":  # pragma: no cover
    main()
