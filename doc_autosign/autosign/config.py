"""Loads and validates the two YAML files that drive everything:

- document_types.yaml: per document type, the ordered approval steps and where
  each step's signature goes (placeholder text, PDF form field, or fixed box).
- users.yaml: who can approve, their roles, and their signature images.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import yaml

MM = 72 / 25.4  # PDF points per millimetre

PLACEMENT_MODES = {"text", "field", "fixed"}
ANCHORS = {"over", "above", "below", "right", "left"}


class ConfigError(ValueError):
    pass


@dataclass
class SignatureSlot:
    """Where and how one approval step's signature is drawn."""

    mode: str = "text"  # text | field | fixed
    placeholder: str = ""  # text token or form-field name
    occurrence: str | int = "all"  # all | first | last | 1-based index
    page: int | None = None  # fixed mode: 1-based page; negative counts from the end
    rect_mm: tuple[float, float, float, float] | None = None  # fixed mode: x, y, w, h from top-left
    width_mm: float = 40.0
    height_mm: float = 15.0
    anchor: str = "over"  # position of the signature box relative to the placeholder
    offset_mm: tuple[float, float] = (0.0, 0.0)
    variant: str = "full"  # which of the user's signature images to use
    caption: str = "{name}\n{date}"  # "" for no caption
    caption_font_size: float = 7.0
    date_format: str = "%d-%b-%Y"
    remove_placeholder: bool = True
    required: bool = True


@dataclass
class Step:
    id: str
    label: str
    slots: list[SignatureSlot]  # one click can place several marks, e.g. signature + initials on every page
    role: str | None = None
    user: str | None = None
    assignable: bool = False  # submitter picks the approver when uploading


@dataclass
class DocumentType:
    id: str
    name: str
    steps: list[Step]
    distinct_approvers: bool = True  # one person cannot sign two steps
    append_audit_page: bool = False  # PDF only: add an approval certificate page at the end
    output_pdf: bool = False  # convert DOCX to PDF (LibreOffice) once fully approved

    def step(self, step_id: str) -> Step:
        for s in self.steps:
            if s.id == step_id:
                return s
        raise ConfigError(f"document type '{self.id}' has no step '{step_id}'")


@dataclass
class User:
    id: str
    name: str
    email: str = ""
    designation: str = ""
    roles: list[str] = field(default_factory=list)
    signatures: dict[str, str] = field(default_factory=dict)  # variant -> image path
    password_hash: str = ""
    admin: bool = False


@dataclass
class AppConfig:
    document_types: dict[str, DocumentType]
    users: dict[str, User]
    base_dir: Path

    def doc_type(self, doc_type_id: str) -> DocumentType:
        try:
            return self.document_types[doc_type_id]
        except KeyError:
            raise ConfigError(f"unknown document type '{doc_type_id}'") from None

    def user(self, user_id: str) -> User:
        try:
            return self.users[user_id]
        except KeyError:
            raise ConfigError(f"unknown user '{user_id}'") from None

    def users_with_role(self, role: str) -> list[User]:
        return [u for u in self.users.values() if role in u.roles]


def _pair(value, name) -> tuple[float, float]:
    if value is None:
        return (0.0, 0.0)
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        raise ConfigError(f"{name} must be a list of 2 numbers")
    return (float(value[0]), float(value[1]))


def _parse_slot(raw: dict, where: str) -> SignatureSlot:
    raw = dict(raw or {})
    slot = SignatureSlot()
    slot.mode = raw.pop("mode", "text")
    if slot.mode not in PLACEMENT_MODES:
        raise ConfigError(f"{where}: mode must be one of {sorted(PLACEMENT_MODES)}")
    slot.placeholder = str(raw.pop("placeholder", ""))
    if slot.mode in {"text", "field"} and not slot.placeholder:
        raise ConfigError(f"{where}: '{slot.mode}' mode needs a placeholder")
    slot.occurrence = raw.pop("occurrence", "all")
    if not (isinstance(slot.occurrence, int) and slot.occurrence >= 1) and slot.occurrence not in {
        "all", "first", "last"
    }:
        raise ConfigError(f"{where}: occurrence must be all, first, last or a positive number")
    slot.page = raw.pop("page", None)
    rect = raw.pop("rect_mm", None)
    if slot.mode == "fixed":
        if slot.page is None or rect is None or len(rect) != 4:
            raise ConfigError(f"{where}: fixed mode needs page and rect_mm: [x, y, w, h]")
        slot.rect_mm = tuple(float(v) for v in rect)
    slot.width_mm = float(raw.pop("width_mm", slot.width_mm))
    slot.height_mm = float(raw.pop("height_mm", slot.height_mm))
    slot.anchor = raw.pop("anchor", "over")
    if slot.anchor not in ANCHORS:
        raise ConfigError(f"{where}: anchor must be one of {sorted(ANCHORS)}")
    slot.offset_mm = _pair(raw.pop("offset_mm", None), f"{where}: offset_mm")
    slot.variant = str(raw.pop("variant", "full"))
    slot.caption = str(raw.pop("caption", slot.caption))
    slot.caption_font_size = float(raw.pop("caption_font_size", slot.caption_font_size))
    slot.date_format = str(raw.pop("date_format", slot.date_format))
    slot.remove_placeholder = bool(raw.pop("remove_placeholder", True))
    slot.required = bool(raw.pop("required", True))
    if raw:
        raise ConfigError(f"{where}: unknown signature keys {sorted(raw)}")
    return slot


def parse_document_types(data: dict) -> dict[str, DocumentType]:
    result = {}
    for dt_id, raw in (data.get("document_types") or {}).items():
        steps_raw = raw.get("steps") or []
        if not steps_raw:
            raise ConfigError(f"document type '{dt_id}' has no steps")
        steps, seen = [], set()
        for i, s in enumerate(steps_raw, 1):
            where = f"document_types.{dt_id}.steps[{i}]"
            sid = s.get("id")
            if not sid or sid in seen:
                raise ConfigError(f"{where}: every step needs a unique id")
            seen.add(sid)
            role, user, assignable = s.get("role"), s.get("user"), bool(s.get("assignable", False))
            if not (role or user or assignable):
                raise ConfigError(f"{where}: set role, user, or assignable: true")
            if "signature" in s and "signatures" in s:
                raise ConfigError(f"{where}: use either signature or signatures, not both")
            if "signatures" in s:
                raw_slots = s["signatures"]
                if not isinstance(raw_slots, list) or not raw_slots:
                    raise ConfigError(f"{where}: signatures must be a non-empty list")
                slots = [_parse_slot(r, f"{where}.signatures[{j}]") for j, r in enumerate(raw_slots, 1)]
            else:
                slots = [_parse_slot(s.get("signature"), f"{where}.signature")]
            steps.append(Step(
                id=sid,
                label=s.get("label", sid),
                slots=slots,
                role=role,
                user=user,
                assignable=assignable,
            ))
        result[dt_id] = DocumentType(
            id=dt_id,
            name=raw.get("name", dt_id),
            steps=steps,
            distinct_approvers=bool(raw.get("distinct_approvers", True)),
            append_audit_page=bool(raw.get("append_audit_page", False)),
            output_pdf=bool(raw.get("output_pdf", False)),
        )
    return result


def parse_users(data: dict) -> dict[str, User]:
    result = {}
    for uid, raw in (data.get("users") or {}).items():
        sigs = raw.get("signatures") or {}
        if isinstance(sigs, str):
            sigs = {"full": sigs}
        result[uid] = User(
            id=uid,
            name=raw.get("name", uid),
            email=raw.get("email", ""),
            designation=raw.get("designation", ""),
            roles=list(raw.get("roles") or []),
            signatures={str(k): str(v) for k, v in sigs.items()},
            password_hash=raw.get("password_hash", ""),
            admin=bool(raw.get("admin", False)),
        )
    return result


def load_config(config_dir: str | Path) -> AppConfig:
    config_dir = Path(config_dir)
    with open(config_dir / "document_types.yaml", encoding="utf-8") as f:
        doc_types = parse_document_types(yaml.safe_load(f) or {})
    with open(config_dir / "users.yaml", encoding="utf-8") as f:
        users = parse_users(yaml.safe_load(f) or {})
    cfg = AppConfig(document_types=doc_types, users=users, base_dir=config_dir)
    validate(cfg)
    return cfg


def validate(cfg: AppConfig) -> None:
    for dt in cfg.document_types.values():
        for step in dt.steps:
            if step.user and step.user not in cfg.users:
                raise ConfigError(f"{dt.id}.{step.id}: user '{step.user}' is not in users.yaml")
            if step.role and not step.assignable and not cfg.users_with_role(step.role):
                raise ConfigError(f"{dt.id}.{step.id}: nobody has role '{step.role}'")
