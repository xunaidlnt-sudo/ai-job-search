"""Email notifications. Each approver gets a link that opens the document with
Approve / Reject buttons. The link only opens a page; the approval itself is a
POST from that page, so mail scanners that pre-fetch links cannot approve
anything."""

from __future__ import annotations

import logging
import os
import smtplib
from email.message import EmailMessage
from typing import Callable

log = logging.getLogger("autosign.mail")


class Notifier:
    def __init__(self, link_for: Callable[[str, str, str], str], request_url: Callable[[str], str]):
        self.link_for = link_for  # (request_id, step_id, user_id) -> one-click link
        self.request_url = request_url

    def approval_needed(self, req, doc_type, step, user) -> None:
        link = self.link_for(req.id, step.id, user.id)
        self.send(
            user.email,
            f"Approval needed: {req.title} ({doc_type.name})",
            f"Hello {user.name},\n\n"
            f"'{req.title}' is waiting for your approval as {step.label}.\n\n"
            f"Review and approve: {link}\n\n"
            f"Approving will place your signature on the document at the {step.label} position.\n",
        )

    def status_changed(self, req, doc_type, submitter, event, comment="", actor="") -> None:
        if event == "completed":
            subject = f"Fully approved: {req.title}"
            body = f"All approvals are done and the signed document is ready:\n{self.request_url(req.id)}\n"
        else:
            subject = f"Rejected: {req.title}"
            body = f"{actor} rejected '{req.title}'.\nComment: {comment or '-'}\n{self.request_url(req.id)}\n"
        self.send(submitter.email, subject, f"Hello {submitter.name},\n\n{body}")

    def send(self, to: str, subject: str, body: str) -> None:
        raise NotImplementedError


class ConsoleNotifier(Notifier):
    """Logs emails instead of sending them. Default when SMTP is not set up."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.outbox: list[tuple[str, str, str]] = []

    def send(self, to, subject, body):
        self.outbox.append((to, subject, body))
        log.info("EMAIL to=%s subject=%s\n%s", to, subject, body)


class SmtpNotifier(Notifier):
    """Settings come from AUTOSIGN_SMTP_HOST / _PORT / _USER / _PASSWORD / _FROM
    and AUTOSIGN_SMTP_STARTTLS (default on)."""

    def send(self, to, subject, body):
        if not to:
            log.warning("no email address for recipient of %r", subject)
            return
        msg = EmailMessage()
        msg["From"] = os.environ.get("AUTOSIGN_SMTP_FROM", os.environ.get("AUTOSIGN_SMTP_USER", "autosign@localhost"))
        msg["To"] = to
        msg["Subject"] = subject
        msg.set_content(body)
        host = os.environ["AUTOSIGN_SMTP_HOST"]
        port = int(os.environ.get("AUTOSIGN_SMTP_PORT", "587"))
        try:
            with smtplib.SMTP(host, port, timeout=30) as smtp:
                if os.environ.get("AUTOSIGN_SMTP_STARTTLS", "1") != "0":
                    smtp.starttls()
                if os.environ.get("AUTOSIGN_SMTP_USER"):
                    smtp.login(os.environ["AUTOSIGN_SMTP_USER"], os.environ.get("AUTOSIGN_SMTP_PASSWORD", ""))
                smtp.send_message(msg)
        except (OSError, smtplib.SMTPException):
            # A mail outage must not undo an approval that already happened.
            log.exception("failed to send %r to %s", subject, to)
