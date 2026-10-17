"""Writes the server's OpenAPI schema, the source of the desktop app's API types.

Run by ``pnpm gen:api`` as ``python -m tassel.scripts.export_openapi [OUTPUT]``. The default
output is packages/shared/src/api/openapi.json in this repository.
"""

import argparse
import json
from pathlib import Path

from tassel.app import create_app

# src/tassel/scripts/export_openapi.py -> the repository root is five levels up.
DEFAULT_OUTPUT = Path(__file__).resolve().parents[5] / "packages/shared/src/api/openapi.json"


def export(output: Path) -> None:
    schema = json.dumps(create_app().openapi(), sort_keys=True, indent=2) + "\n"
    output.parent.mkdir(parents=True, exist_ok=True)
    # LF on every platform, so `pnpm check:api` matches the LF checkout on Windows too.
    output.write_text(schema, encoding="utf-8", newline="\n")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", nargs="?", type=Path, default=DEFAULT_OUTPUT)
    export(parser.parse_args(argv).output)


if __name__ == "__main__":
    main()
