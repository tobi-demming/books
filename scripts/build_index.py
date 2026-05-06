#!/usr/bin/env python3
"""
build_index.py — regenerate books/index.json by listing every .md file
in the books/ directory.

Run from the project root:
    python3 scripts/build_index.py

GitHub Pages serves a static file system, so we can't list directory
contents at runtime. This script keeps the manifest in sync.

You can also wire this up as a GitHub Actions workflow that runs on
every push to main — see README.md.
"""

from __future__ import annotations
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BOOKS_DIR = ROOT / "books"
INDEX_PATH = BOOKS_DIR / "index.json"


def main() -> None:
    if not BOOKS_DIR.is_dir():
        raise SystemExit(f"books directory not found: {BOOKS_DIR}")

    md_files = sorted(p.name for p in BOOKS_DIR.glob("*.md"))
    if not md_files:
        print("Warning: no .md files found in books/")

    manifest = {"books": md_files}
    INDEX_PATH.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {INDEX_PATH.relative_to(ROOT)} ({len(md_files)} books)")


if __name__ == "__main__":
    main()
