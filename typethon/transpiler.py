"""TypeScript -> Python transpiler.

This is intentionally scoped to a small, well-defined subset of TypeScript:
algorithmic code, no DOM, no Node builtins, no prototype manipulation. The
goal (per the design notes in the project HTML) is not idiomatic Python --
the output is a compilation artifact that happens to be valid Python so
that ``import numpy`` and friends just work.

The strategy is a two-stage transform:

1. Tokenize the source while preserving string literals and comments.
2. Walk tokens and emit Python, using a brace-stack to translate ``{}``
   blocks into Python indentation.

Anything the transpiler doesn't recognize is passed through verbatim. This
keeps the tool useful for incremental adoption -- you can hand-edit the
output and the transpiler won't fight you on the parts it understands.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# Mapping from TypeScript type annotations to Python type annotations.
# Only the cases with a clean Python analog are mapped; everything else
# falls back to ``Any``.
TYPE_MAP: dict[str, str] = {
    "number": "float",
    "string": "str",
    "boolean": "bool",
    "bigint": "int",
    "void": "None",
    "null": "None",
    "undefined": "None",
    "any": "Any",
    "unknown": "Any",
    "never": "Any",
    "object": "dict",
}

# Token-level identifier replacements applied to expression text. These are
# safe because the tokenizer hands us code with strings/comments stripped
# out of band, so we won't rewrite anything inside a string literal.
IDENT_REPLACEMENTS: dict[str, str] = {
    "true": "True",
    "false": "False",
    "null": "None",
    "undefined": "None",
}

# Operator replacements. Order matters: longer operators must be tried
# before their prefixes (``===`` before ``==``).
OPERATOR_REPLACEMENTS: list[tuple[str, str]] = [
    ("===", "=="),
    ("!==", "!="),
    ("&&", " and "),
    ("||", " or "),
]


@dataclass
class Pragma:
    """Parsed file-level pragma directives.

    Pragmas live in ``//`` comments at the top of the file:

        // @typethon target: python
        // @typethon import: numpy as np
        // @typethon import: pandas as pd
    """

    target: str = "python"
    imports: list[str] = field(default_factory=list)


def _parse_pragmas(source: str) -> Pragma:
    pragma = Pragma()
    for line in source.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if not stripped.startswith("//"):
            # Stop at the first non-comment, non-blank line. Pragmas only
            # apply if they appear in the file's leading comment block.
            break
        body = stripped[2:].strip()
        if not body.startswith("@typethon"):
            continue
        directive = body[len("@typethon"):].strip().lstrip(":").strip()
        if directive.startswith("target"):
            _, _, value = directive.partition(":")
            pragma.target = value.strip() or pragma.target
        elif directive.startswith("import"):
            _, _, value = directive.partition(":")
            value = value.strip()
            if value:
                pragma.imports.append(value)
    return pragma


def _strip_strings_and_comments(source: str) -> tuple[str, dict[str, str]]:
    """Replace string literals and comments with placeholders.

    Returns the rewritten source plus a placeholder->original map so that
    we can splice the originals back in after token-level rewrites.
    """
    placeholders: dict[str, str] = {}
    counter = 0

    def stash(value: str) -> str:
        nonlocal counter
        key = f"__TYPETHON_TOK_{counter}__"
        counter += 1
        placeholders[key] = value
        return key

    out: list[str] = []
    i = 0
    n = len(source)
    while i < n:
        ch = source[i]
        # Line comment
        if ch == "/" and i + 1 < n and source[i + 1] == "/":
            end = source.find("\n", i)
            end = n if end == -1 else end
            comment = source[i:end]
            # Translate to a Python comment so it survives unchanged.
            out.append(stash("#" + comment[2:]))
            i = end
            continue
        # Block comment -> Python ``#`` lines, joined by newlines so the
        # surrounding indentation logic still works.
        if ch == "/" and i + 1 < n and source[i + 1] == "*":
            end = source.find("*/", i + 2)
            end = n if end == -1 else end + 2
            block = source[i:end]
            inner = block[2:-2] if block.endswith("*/") else block[2:]
            py_comment = "\n".join("# " + ln.lstrip(" *") for ln in inner.splitlines())
            out.append(stash(py_comment))
            i = end
            continue
        # String literal (single, double, or template). Templates are
        # passed through verbatim -- the user is expected to keep them
        # simple; we don't try to expand ``${...}`` interpolation here.
        if ch in ("'", '"', "`"):
            quote = ch
            j = i + 1
            while j < n:
                if source[j] == "\\" and j + 1 < n:
                    j += 2
                    continue
                if source[j] == quote:
                    j += 1
                    break
                j += 1
            literal = source[i:j]
            if quote == "`":
                # Template literal -> Python f-string. Best-effort: only
                # safe when the template contains no ``${...}``.
                inner = literal[1:-1]
                if "${" in inner:
                    out.append(stash(literal))  # leave it; user must fix
                else:
                    out.append(stash('"' + inner.replace('"', '\\"') + '"'))
            else:
                out.append(stash(literal))
            i = j
            continue
        out.append(ch)
        i += 1
    return "".join(out), placeholders


def _restore(text: str, placeholders: dict[str, str]) -> str:
    for key, value in placeholders.items():
        text = text.replace(key, value)
    return text


def _map_type(ts_type: str) -> str:
    ts_type = ts_type.strip()
    if not ts_type:
        return "Any"
    # Arrays: ``T[]`` and ``Array<T>``
    m = re.fullmatch(r"(.+)\[\]", ts_type)
    if m:
        return f"list[{_map_type(m.group(1))}]"
    m = re.fullmatch(r"Array<(.+)>", ts_type)
    if m:
        return f"list[{_map_type(m.group(1))}]"
    # Union types -> typing.Union via ``A | B`` (PEP 604). ``None`` falls
    # out naturally for ``T | null``.
    if "|" in ts_type and "<" not in ts_type:
        parts = [_map_type(p) for p in ts_type.split("|")]
        return " | ".join(parts)
    return TYPE_MAP.get(ts_type, ts_type)


def _convert_type_annotations(text: str) -> str:
    # ``: T`` annotations on params and variables. We stop at the next
    # comma, closing paren, equals, or end-of-line so multi-arg signatures
    # work without a real parser.
    def repl(match: re.Match[str]) -> str:
        ts_type = match.group(1).strip()
        return ": " + _map_type(ts_type)

    return re.sub(r":\s*([A-Za-z_][\w<>\[\]\| ,]*?)(?=[,)=\n{])", repl, text)


def _convert_return_annotations(text: str) -> str:
    def repl(match: re.Match[str]) -> str:
        # Keep the trailing ``{`` so the brace-to-indent pass still sees
        # a block opener. The ``:`` is left in place by the rewrite below
        # because Python doesn't allow ``-> T: {`` directly -- we'll
        # strip the colon when collapsing braces.
        return ") -> " + _map_type(match.group(1).strip()) + " {"

    return re.sub(r"\)\s*:\s*([A-Za-z_][\w<>\[\]\| ,]*?)\s*\{", repl, text)


def _convert_function_decls(text: str) -> str:
    # ``function name(args) {`` and ``function name(args): T {`` (the
    # latter is handled by ``_convert_return_annotations`` first). The
    # trailing ``{`` is left in place; ``_braces_to_indent`` will both
    # consume it and append the ``:`` Python expects.
    text = re.sub(r"\bfunction\s+([A-Za-z_]\w*)\s*\(", r"def \1(", text)
    return text


def _convert_control_flow(text: str) -> str:
    # All rewrites preserve the trailing ``{`` so the brace-to-indent
    # pass still sees a block opener and pushes an indent. The colon is
    # added later when ``{`` is collapsed.
    # ``else if`` must be rewritten before ``if`` so the bare ``if``
    # pattern doesn't eat the ``if (...)`` half of ``} else if (...)``.
    text = re.sub(r"\}\s*else\s+if\s*\((.*?)\)\s*\{", lambda m: f"}}\nelif {m.group(1).strip()} {{", text)
    text = re.sub(r"\}\s*else\s*\{", "}\nelse {", text)
    text = re.sub(r"\bif\s*\((.*?)\)\s*\{", lambda m: f"if {m.group(1).strip()} {{", text)
    text = re.sub(r"\bwhile\s*\((.*?)\)\s*\{", lambda m: f"while {m.group(1).strip()} {{", text)
    # ``for (let i = 0; i < n; i++)`` -> ``for i in range(n) {``
    text = re.sub(
        r"\bfor\s*\(\s*(?:let|const|var)\s+(\w+)\s*=\s*0\s*;\s*\1\s*<\s*([^;]+?)\s*;\s*\1\+\+\s*\)\s*\{",
        lambda m: f"for {m.group(1)} in range({m.group(2).strip()}) {{",
        text,
    )
    # ``for (const x of xs)`` -> ``for x in xs {``
    text = re.sub(
        r"\bfor\s*\(\s*(?:let|const|var)\s+(\w+)\s+of\s+([^)]+?)\)\s*\{",
        lambda m: f"for {m.group(1)} in {m.group(2).strip()} {{",
        text,
    )
    return text


def _convert_var_decls(text: str) -> str:
    # ``const x = ...`` / ``let x = ...`` / ``var x = ...``
    text = re.sub(r"\b(?:const|let|var)\s+", "", text)
    return text


def _convert_console(text: str) -> str:
    return text.replace("console.log", "print")


def _convert_operators(text: str) -> str:
    for src, dst in OPERATOR_REPLACEMENTS:
        text = text.replace(src, dst)
    # ``!x`` -> ``not x`` (only when not part of ``!=``)
    text = re.sub(r"(?<![=!<>])!(?!=)", "not ", text)
    return text


def _convert_identifiers(text: str) -> str:
    def repl(match: re.Match[str]) -> str:
        word = match.group(0)
        return IDENT_REPLACEMENTS.get(word, word)

    return re.sub(r"\b[A-Za-z_]\w*\b", repl, text)


def _strip_semicolons(text: str) -> str:
    # Trailing ``;`` at end of a logical line.
    return re.sub(r";\s*(?=\n|$)", "", text)


def _braces_to_indent(text: str) -> str:
    """Convert remaining ``{ ... }`` blocks into Python indentation.

    By the time this runs, every block-introducing construct should end
    in ``:`` immediately before its ``{``. We scan line-by-line, push an
    indent on ``{``, and pop on ``}``.
    """
    out: list[str] = []
    indent = 0
    pad = "    "
    for raw_line in text.splitlines():
        line = raw_line.rstrip()
        # Lines that are *just* a closing brace -> dedent silently.
        stripped = line.strip()
        if stripped == "}":
            indent = max(0, indent - 1)
            continue
        # Trailing ``{`` on a header line: drop it, queue the indent.
        opens = False
        if stripped.endswith("{"):
            line = line[: line.rfind("{")].rstrip()
            opens = True
            # Ensure block headers end in ``:``. This covers cases like
            # ``def f(...) -> T`` where the upstream rewrite kept the
            # ``{`` instead of emitting ``:`` directly.
            if line and not line.endswith(":"):
                line = line + ":"
        # Leading ``}`` (e.g. ``} else:`` after our earlier rewrites
        # collapsed to a bare ``else:`` -- this branch handles stray
        # cases that didn't match those patterns).
        while line.lstrip().startswith("}"):
            indent = max(0, indent - 1)
            line = line.lstrip()[1:].lstrip()
        if line.strip():
            out.append(pad * indent + line.strip())
        elif opens:
            # Empty body header -- emit a ``pass`` to keep Python happy.
            out.append(pad * indent + "pass")
        if opens:
            indent += 1
    return "\n".join(out)


def transpile(source: str) -> str:
    """Transpile a TypeScript source string to Python source code."""
    pragma = _parse_pragmas(source)

    text, placeholders = _strip_strings_and_comments(source)

    text = _convert_return_annotations(text)
    # Control flow must run before function decls because the function
    # rewrite collapses any ``) {`` into ``):`` -- which would otherwise
    # destroy the ``for (let i = 0; ...) {`` / ``if (...) {`` patterns.
    text = _convert_control_flow(text)
    text = _convert_function_decls(text)
    text = _convert_type_annotations(text)
    text = _convert_var_decls(text)
    text = _convert_console(text)
    text = _convert_operators(text)
    text = _convert_identifiers(text)
    text = _strip_semicolons(text)
    text = _braces_to_indent(text)

    text = _restore(text, placeholders)

    header_lines: list[str] = []
    if any("Any" in line for line in text.splitlines()):
        header_lines.append("from typing import Any")
    for imp in pragma.imports:
        header_lines.append(f"import {imp}")
    header = "\n".join(header_lines)
    if header:
        return header + "\n\n" + text.lstrip("\n")
    return text.lstrip("\n")
