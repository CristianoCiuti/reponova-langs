"""Tiny CLI utility used as a "simple" extraction fixture."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

DEFAULT_TIMEOUT_SEC = 30
MAX_RETRIES = 5


def parse_args(argv: list[str]) -> argparse.Namespace:
    """Parse command-line arguments and return the populated namespace."""
    parser = argparse.ArgumentParser(prog="hello")
    parser.add_argument("--name", default="world", help="who to greet")
    parser.add_argument("--upper", action="store_true", help="uppercase output")
    return parser.parse_args(argv)


class Greeter:
    """Stateful greeter that remembers a prefix."""

    def __init__(self, prefix: str = "Hello") -> None:
        self.prefix = prefix

    def greet(self, name: str, *, upper: bool = False) -> str:
        """Render the greeting, optionally uppercased."""
        rendered = f"{self.prefix}, {name}!"
        return rendered.upper() if upper else rendered


def main(argv: list[str] | None = None) -> int:
    """Entry point: parses args, greets, and writes to stdout."""
    args = parse_args(argv if argv is not None else sys.argv[1:])
    greeter = Greeter()
    print(greeter.greet(args.name, upper=args.upper))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
