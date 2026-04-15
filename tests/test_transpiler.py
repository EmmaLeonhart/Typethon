"""End-to-end tests for the Typethon transpiler.

Each test runs a snippet of TypeScript through ``transpile`` and then
``exec``s the resulting Python in an isolated namespace. We assert on the
*behavior* of the output rather than its exact text, since the transpiler
is allowed to evolve its formatting -- per the design notes, the output
is a compilation artifact, not maintainable Python.
"""

from __future__ import annotations

import textwrap

import pytest

from typethon import transpile


def run(ts: str) -> dict:
    py = transpile(textwrap.dedent(ts))
    namespace: dict = {}
    exec(compile(py, "<transpiled>", "exec"), namespace)
    return namespace


def test_simple_function_add():
    ns = run(
        """
        function add(a: number, b: number): number {
            return a + b;
        }
        """
    )
    assert ns["add"](2, 3) == 5


def test_if_else_branch():
    ns = run(
        """
        function sign(x: number): number {
            if (x > 0) {
                return 1;
            } else if (x < 0) {
                return -1;
            } else {
                return 0;
            }
        }
        """
    )
    assert ns["sign"](5) == 1
    assert ns["sign"](-2) == -1
    assert ns["sign"](0) == 0


def test_for_range_loop():
    ns = run(
        """
        function sumTo(n: number): number {
            let total = 0;
            for (let i = 0; i < n; i++) {
                total = total + i;
            }
            return total;
        }
        """
    )
    assert ns["sumTo"](5) == 0 + 1 + 2 + 3 + 4


def test_for_of_loop():
    ns = run(
        """
        function total(xs: number[]): number {
            let acc = 0;
            for (const x of xs) {
                acc = acc + x;
            }
            return acc;
        }
        """
    )
    assert ns["total"]([1, 2, 3, 4]) == 10


def test_boolean_literals_and_operators():
    ns = run(
        """
        function both(a: boolean, b: boolean): boolean {
            return a && b;
        }
        function either(a: boolean, b: boolean): boolean {
            return a || b;
        }
        function negate(a: boolean): boolean {
            return !a;
        }
        """
    )
    assert ns["both"](True, False) is False
    assert ns["both"](True, True) is True
    assert ns["either"](False, True) is True
    assert ns["negate"](False) is True


def test_strict_equality_collapses():
    ns = run(
        """
        function eq(a: number, b: number): boolean {
            return a === b;
        }
        function neq(a: number, b: number): boolean {
            return a !== b;
        }
        """
    )
    assert ns["eq"](2, 2) is True
    assert ns["neq"](2, 3) is True


def test_console_log_becomes_print(capsys):
    run(
        """
        console.log("hello");
        """
    )
    captured = capsys.readouterr()
    assert "hello" in captured.out


def test_pragma_imports_are_emitted():
    py = transpile(
        textwrap.dedent(
            """
            // @typethon target: python
            // @typethon import: math
            function area(r: number): number {
                return 3.14 * r * r;
            }
            """
        )
    )
    assert "import math" in py


def test_string_literal_passthrough():
    ns = run(
        """
        function greet(name: string): string {
            return "hello, " + name;
        }
        """
    )
    assert ns["greet"]("world") == "hello, world"


def test_null_and_undefined_become_none():
    ns = run(
        """
        function nothing(): any {
            return null;
        }
        function alsoNothing(): any {
            return undefined;
        }
        """
    )
    assert ns["nothing"]() is None
    assert ns["alsoNothing"]() is None
