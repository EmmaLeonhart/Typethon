"""Command-line entry point for the Typethon transpiler."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .transpiler import transpile


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="typethon",
        description="Transpile a restricted TypeScript subset to Python.",
    )
    parser.add_argument("input", type=Path, help="Path to a .ts source file.")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="Path to write Python output. Defaults to stdout.",
    )
    args = parser.parse_args(argv)

    source = args.input.read_text(encoding="utf-8")
    result = transpile(source)

    if args.output is None:
        sys.stdout.write(result)
        if not result.endswith("\n"):
            sys.stdout.write("\n")
    else:
        args.output.write_text(result + ("\n" if not result.endswith("\n") else ""), encoding="utf-8")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
