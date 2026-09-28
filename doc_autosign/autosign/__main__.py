"""Command line: python -m autosign <command>

  serve            run the web app
  init-demo        fake signatures for every user + a few example requests
  check FILE -t T  show which signature placeholders FILE has for document type T
  stamp FILE ...   sign one step of a file directly, no workflow
  add-signature    store a user's scanned signature
  hash-password    make a password_hash for users.yaml
"""

from __future__ import annotations

import argparse
import getpass
import logging
import os
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="python -m autosign")
    p.add_argument("--config", default=os.environ.get("AUTOSIGN_CONFIG", ROOT / "config"), type=Path)
    p.add_argument("--data", default=os.environ.get("AUTOSIGN_DATA", ROOT / "data"), type=Path)
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("serve")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", default=5000, type=int)

    d = sub.add_parser("init-demo")
    d.add_argument("--refresh-samples", action="store_true", help="regenerate files in samples/")

    c = sub.add_parser("check")
    c.add_argument("file", type=Path)
    c.add_argument("-t", "--doc-type", required=True)

    st = sub.add_parser("stamp")
    st.add_argument("file", type=Path)
    st.add_argument("-t", "--doc-type", required=True)
    st.add_argument("-s", "--step", required=True)
    st.add_argument("-u", "--user", required=True)
    st.add_argument("-o", "--out", type=Path)

    a = sub.add_parser("add-signature")
    a.add_argument("user")
    a.add_argument("image", type=Path)
    a.add_argument("--variant", default="full")
    a.add_argument("--no-clean", action="store_true", help="store the image as-is")

    sub.add_parser("hash-password")

    args = p.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

    if args.cmd == "hash-password":
        from werkzeug.security import generate_password_hash
        pw = getpass.getpass("Password: ")
        if pw != getpass.getpass("Again: "):
            print("Passwords differ.", file=sys.stderr)
            return 1
        print(generate_password_hash(pw))
        return 0

    from . import stamper
    from .config import load_config
    from .signatures import SignatureStore

    cfg = load_config(args.config)

    if args.cmd == "serve":
        from .web import create_app
        app = create_app(args.config, args.data)
        if not os.environ.get("AUTOSIGN_SECRET_KEY"):
            logging.warning("AUTOSIGN_SECRET_KEY not set: sessions and email links break on every restart")
        app.run(host=args.host, port=args.port)
        return 0

    if args.cmd == "init-demo":
        from . import demo
        samples = ROOT / "samples"
        for path in demo.write_samples(samples, overwrite=args.refresh_samples):
            print("wrote", path)
        demo.give_everyone_signatures(cfg, args.data)
        print("Every configured user has a demo signature and initials (existing uploads kept).")
        for line in demo.seed_requests(cfg, args.data, samples):
            print("seeded:", line)
        print(f"Sample documents to try are in {samples}")
        return 0

    if args.cmd == "check":
        dt = cfg.doc_type(args.doc_type)
        counts = stamper.check_placeholders(args.file.read_bytes(), args.file.name, dt)
        for step in dt.steps:
            for slot, n in zip(step.slots, counts[step.id]):
                flag = "ok" if n else ("MISSING" if slot.required else "missing (optional)")
                where = slot.placeholder or f"page {slot.page} box {list(slot.rect_mm)}"
                print(f"{step.label:<22} {where:<34} {n} spot(s)  {flag}")
        return 2 if stamper.missing_placeholders(counts, dt) else 0

    if args.cmd == "stamp":
        dt = cfg.doc_type(args.doc_type)
        step = dt.step(args.step)
        user = cfg.user(args.user)
        store = SignatureStore(cfg, args.data / "signatures")
        signer = stamper.Signer(name=user.name, designation=user.designation, email=user.email,
                                step_label=step.label, when=datetime.now().astimezone())
        out = args.out or args.file.with_name(f"{args.file.stem}_signed{args.file.suffix}")
        out.write_bytes(stamper.sign_step(args.file.read_bytes(), args.file.name, step,
                                          lambda variant: store.get(user.id, variant), signer))
        print("wrote", out)
        return 0

    if args.cmd == "add-signature":
        store = SignatureStore(cfg, args.data / "signatures")
        path = store.save(args.user, args.variant, args.image.read_bytes(), clean=not args.no_clean)
        print("saved", path)
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
