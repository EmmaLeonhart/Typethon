import { transpile } from "./typethon.js";

const EXAMPLES = [
  {
    name: "Hello world",
    ts: `console.log("hello, world");\n`,
  },
  {
    name: "Add two numbers",
    ts: `function add(a: number, b: number): number {
    return a + b;
}

console.log(add(2, 3));
`,
  },
  {
    name: "Sign of a number",
    ts: `function sign(x: number): number {
    if (x > 0) {
        return 1;
    } else if (x < 0) {
        return -1;
    } else {
        return 0;
    }
}
`,
  },
  {
    name: "Sum 0..n with a for loop",
    ts: `function sumTo(n: number): number {
    let total = 0;
    for (let i = 0; i < n; i++) {
        total = total + i;
    }
    return total;
}
`,
  },
  {
    name: "Iterate an array",
    ts: `function total(xs: number[]): number {
    let acc = 0;
    for (const x of xs) {
        acc = acc + x;
    }
    return acc;
}
`,
  },
  {
    name: "Dot product (with numpy pragma)",
    ts: `// @typethon target: python
// @typethon import: numpy as np

function dotProduct(a: number[], b: number[]): number {
    let total = 0;
    for (let i = 0; i < a.length; i++) {
        total = total + a[i] * b[i];
    }
    return total;
}
`,
  },
  {
    name: "Strict equality and booleans",
    ts: `function eq(a: number, b: number): boolean {
    return a === b && b !== 0;
}

const ok = eq(2, 2);
const flag = !ok || true;
`,
  },
];

const exampleSelect = /** @type {HTMLSelectElement} */ (document.getElementById("example"));
const tsBox = /** @type {HTMLTextAreaElement} */ (document.getElementById("ts"));
const pyBox = /** @type {HTMLElement} */ (document.querySelector("#py code"));

for (let i = 0; i < EXAMPLES.length; i++) {
  const opt = document.createElement("option");
  opt.value = String(i);
  opt.textContent = EXAMPLES[i].name;
  exampleSelect.appendChild(opt);
}

function render() {
  try {
    pyBox.textContent = transpile(tsBox.value);
  } catch (err) {
    pyBox.textContent = "# transpile error: " + (err && err.message ? err.message : String(err));
  }
}

function loadExample(idx) {
  tsBox.value = EXAMPLES[idx].ts;
  render();
}

exampleSelect.addEventListener("change", () => loadExample(Number(exampleSelect.value)));
tsBox.addEventListener("input", render);

loadExample(1);
