#!/usr/bin/env python3
"""Organize and bundle frontend assets for module-based development.

Primary workflow:
  1) edit semantic modules under `frontend_src/modules/`
  2) build -> bundle modules back into deployment files (`app.js`, `style.css`)

Legacy migration helper:
  bootstrap / organize can still regenerate the module tree from the historical
  monolithic files, but they are no longer part of the normal day-to-day workflow.
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
JS_MONO = ROOT / "app.js"
CSS_MONO = ROOT / "style.css"
JS_CHUNK_DIR = ROOT / "frontend_src" / "js"
CSS_CHUNK_DIR = ROOT / "frontend_src" / "css"
JS_MODULE_DIR = ROOT / "frontend_src" / "modules" / "js"
CSS_MODULE_DIR = ROOT / "frontend_src" / "modules" / "css"

JS_MARKER = re.compile(r"^\s*//\s*[\-\u2500]+\s*(.*?)\s*[\-\u2500]+\s*$")
CSS_MARKER = re.compile(r"^\s*/\*\s*=+\s*(.*?)\s*=+\s*\*/\s*$")

JS_MODULE_SPECS = [
    ("core.js", 1, 13),
    ("chat.js", 14, 29),
    ("device.js", 30, 30),
    ("code.js", 31, 31),
    ("ui.js", 32, 36),
]

CSS_MODULE_SPECS = [
    ("base.css", 1, 3),
    ("layout.css", 4, 13),
    ("device.css", 14, 14),
    ("chat.css", 15, 25),
    ("overlays.css", 26, 28),
    ("highlight.css", 29, 29),
    ("responsive.css", 30, 30),
]


def _split_by_marker(text: str, marker: re.Pattern[str]):
    blocks = []
    current_title = "preamble"
    current_lines = []

    for line in text.splitlines(keepends=True):
        m = marker.match(line)
        if m:
            if current_lines:
                blocks.append((current_title, "".join(current_lines)))
            current_title = m.group(1).strip() or "section"
            current_lines = [line]
        else:
            current_lines.append(line)

    if current_lines:
        blocks.append((current_title, "".join(current_lines)))
    return blocks


def _split_monolith(monolith_path: Path, marker: re.Pattern[str], out_dir: Path, ext: str, force: bool) -> None:
    text = monolith_path.read_text(encoding="utf-8")
    blocks = _split_by_marker(text, marker)
    out_dir.mkdir(parents=True, exist_ok=True)

    existing = list(out_dir.glob(f"*.{ext}"))
    if existing and not force:
        raise SystemExit(f"Refuse to overwrite existing {out_dir}. Use --force.")

    for old in existing:
        old.unlink()

    for idx, (title, content) in enumerate(blocks, start=1):
        safe_title = re.sub(r"[^a-z0-9]+", "_", title.strip().lower())
        safe_title = re.sub(r"_+", "_", safe_title).strip("_") or "section"
        name = f"{idx:03d}_{safe_title}.{ext}"
        (out_dir / name).write_text(content, encoding="utf-8")

    print(f"Bootstrapped {len(blocks)} {ext.upper()} chunks -> {out_dir}")


def bootstrap(force: bool) -> None:
    _split_monolith(JS_MONO, JS_MARKER, JS_CHUNK_DIR, "js", force)
    _split_monolith(CSS_MONO, CSS_MARKER, CSS_CHUNK_DIR, "css", force)


def _read_ordered_chunks(src_dir: Path, ext: str):
    files = sorted(src_dir.glob(f"*.{ext}"))
    if not files:
        raise SystemExit(f"No *.{ext} files found in {src_dir}")

    chunks = []
    for file in files:
        text = file.read_text(encoding="utf-8")
        chunks.append({"path": file, "text": text})
    return chunks


def _slice_join(chunks, start: int, end: int) -> str:
    selected = [chunk["text"].rstrip() for chunk in chunks[start - 1 : end]]
    return "\n\n".join(selected).rstrip() + "\n"


def _write_modules(chunks, specs, out_dir: Path, ext: str, force: bool) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    existing = list(out_dir.glob(f"*.{ext}"))
    if existing and not force:
        raise SystemExit(f"Refuse to overwrite existing {out_dir}. Use --force.")

    for old in existing:
        old.unlink()

    for name, start, end in specs:
        content = _slice_join(chunks, start, end)
        (out_dir / name).write_text(content, encoding="utf-8")


def organize(force: bool) -> None:
    js_chunks = _read_ordered_chunks(JS_CHUNK_DIR, "js")
    css_chunks = _read_ordered_chunks(CSS_CHUNK_DIR, "css")
    _write_modules(js_chunks, JS_MODULE_SPECS, JS_MODULE_DIR, "js", force)
    _write_modules(css_chunks, CSS_MODULE_SPECS, CSS_MODULE_DIR, "css", force)
    print(f"Organized JS modules -> {JS_MODULE_DIR}")
    print(f"Organized CSS modules -> {CSS_MODULE_DIR}")


def _bundle(src_dir: Path, ext: str, out_file: Path) -> None:
    files = sorted(src_dir.glob(f"*.{ext}"))
    if not files:
        raise SystemExit(f"No *.{ext} files found in {src_dir}")

    parts = []
    for f in files:
        parts.append(f.read_text(encoding="utf-8").rstrip())
    merged = "\n\n".join(parts) + "\n"
    out_file.write_text(merged, encoding="utf-8")
    print(f"Built {out_file.name} from {len(files)} files")


def build() -> None:
    if not any(JS_MODULE_DIR.glob("*.js")) or not any(CSS_MODULE_DIR.glob("*.css")):
        raise SystemExit(
            "Module sources are missing. Run `python tools/frontend_assets.py organize --force` first."
        )
    _bundle(JS_MODULE_DIR, "js", JS_MONO)
    _bundle(CSS_MODULE_DIR, "css", CSS_MONO)


def main() -> None:
    parser = argparse.ArgumentParser(description="Frontend split/organize/bundle tool")
    parser.add_argument("action", choices=["bootstrap", "organize", "build", "all"])
    parser.add_argument("--force", action="store_true", help="overwrite existing generated files")
    args = parser.parse_args()

    if args.action in ("bootstrap", "all"):
        bootstrap(force=args.force)
    if args.action in ("organize", "all"):
        organize(force=args.force)
    if args.action in ("build", "all"):
        build()


if __name__ == "__main__":
    main()

