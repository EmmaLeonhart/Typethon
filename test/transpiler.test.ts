import { test } from "node:test";
import assert from "node:assert/strict";
import { transpile } from "../src/index.js";

test("function declaration converts to def", () => {
  const py = transpile("function add(a: number, b: number): number {\n    return a + b;\n}\n");
  assert.match(py, /def add\(a: float, b: float\) -> float:/);
  assert.match(py, /return a \+ b/);
});

test("if/else if/else branches", () => {
  const py = transpile(
    [
      "function sign(x: number): number {",
      "    if (x > 0) {",
      "        return 1;",
      "    } else if (x < 0) {",
      "        return -1;",
      "    } else {",
      "        return 0;",
      "    }",
      "}",
      "",
    ].join("\n"),
  );
  assert.match(py, /if x > 0:/);
  assert.match(py, /elif x < 0:/);
  assert.match(py, /else:/);
});

test("for-of becomes for-in", () => {
  const py = transpile("for (const x of xs) {\n  total = total + x;\n}\n");
  assert.match(py, /for x in xs:/);
});

test("strict equality collapses", () => {
  const py = transpile("a === b;\nc !== d;\n");
  assert.match(py, /a == b/);
  assert.match(py, /c != d/);
});

test("logical operators map to python", () => {
  const py = transpile("x && y || !z;\n");
  assert.match(py, /and/);
  assert.match(py, /or/);
  assert.match(py, /not z/);
});

test("console.log becomes print", () => {
  const py = transpile('console.log("hi");\n');
  assert.match(py, /print\("hi"\)/);
});

test("pragma imports surface in output", () => {
  const py = transpile("// @typethon import: numpy as np\nlet x = 1;\n");
  assert.match(py, /import numpy as np/);
});
