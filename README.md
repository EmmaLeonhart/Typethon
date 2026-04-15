# Typethon

> TypeScript syntax. Python runtime ABI.

**[Try it in your browser →](https://emmaleonhart.github.io/Typethon/)**

The live demo runs the transpiler client-side: pick an example, edit the
TypeScript, and watch the Python update in real time.

## What this is

A transpiler from a restricted subset of TypeScript to Python. The output
is **not** idiomatic Python -- it's a compilation artifact that happens to
be valid Python so that `import numpy` and friends just work. Per the
project's design notes, this scopes the problem honestly:

- TypeScript is the source language, with file-level pragmas declaring
  which Python libraries the file expects.
- Python is the runtime ABI -- whatever the transpiler emits is
  semantically correct enough that library calls work.
- No DOM, no Node builtins, no prototype manipulation. Algorithmic code,
  data transforms, schema definitions, utility functions.

## Install

```
pip install -e .
```

## Use

```
typethon path/to/source.ts -o path/to/source.py
```

Or as a library:

```python
from typethon import transpile

py_source = transpile(ts_source)
```

## Pragmas

File-level pragmas live in `//` comments at the top of the file:

```ts
// @typethon target: python
// @typethon import: numpy as np
// @typethon import: pandas as pd

function dotProduct(a: number[], b: number[]): number {
    let total = 0;
    for (let i = 0; i < a.length; i++) {
        total = total + a[i] * b[i];
    }
    return total;
}
```

## Currently supported

- `function` declarations with typed params and return types
- `if` / `else if` / `else`, `while`, `for (let i = 0; i < n; i++)`,
  `for (const x of xs)`
- `const` / `let` / `var` declarations (the keyword is dropped)
- Type annotations: `number`, `string`, `boolean`, `void`, `null`,
  `undefined`, `any`, `T[]`, `Array<T>`, union types
- Strict equality (`===` / `!==`), logical operators (`&&`, `||`, `!`)
- `console.log` -> `print`
- String, comment, and template literal pass-through

## Not yet supported

Classes, interfaces, generics, async/await, destructuring, spread,
arrow function bodies that aren't single expressions, template literal
interpolation. The transpiler passes unrecognized constructs through
verbatim, so you can incrementally hand-edit the output.

## Two implementations, same transpiler

The transpiler exists in two parallel ports:

- **Python** (`typethon/`) — install with `pip install -e .`, run via the
  `typethon` CLI or `from typethon import transpile`.
- **TypeScript / browser** (`src/`) — `npm install && npm run build`. The
  browser playground in `site/` imports the compiled output, and the
  package is structured for eventual `npm publish`.

Both produce the same Python output (modulo whitespace).

## Tests

```
pytest        # Python
npm test      # TypeScript port
```

## On the output quality

The Python the transpiler emits isn't the prettiest — it's a compilation
artifact, not maintainable code. But it's also not pathologically slow:
no eval-string trampolines, no per-call dict lookups, no shim layers
that would tank performance. Functions are functions, loops are loops,
arithmetic is arithmetic. The runtime cost should track what you'd get
from writing the equivalent code by hand.
