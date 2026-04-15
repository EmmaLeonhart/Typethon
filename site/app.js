import { transpile } from "./typethon.js?v=3";

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
  {
    name: "NumPy — normalize a vector",
    ts: `// @typethon target: python
// @typethon import: numpy as np

function normalize(v: number[]): number[] {
    const arr = np.array(v);
    const norm = np.linalg.norm(arr);
    return arr / norm;
}

const unit = normalize([3, 4, 0]);
console.log(unit);
`,
  },
  {
    name: "NumPy — matrix multiply",
    ts: `// @typethon target: python
// @typethon import: numpy as np

function matmul(a: number[][], b: number[][]): number[][] {
    const A = np.array(a);
    const B = np.array(b);
    return np.matmul(A, B);
}

const C = matmul([[1, 2], [3, 4]], [[5, 6], [7, 8]]);
console.log(C);
`,
  },
  {
    name: "TensorFlow — train a tiny model",
    ts: `// @typethon target: python
// @typethon import: tensorflow as tf
// @typethon import: numpy as np

function trainLinear(xs: number[], ys: number[]): any {
    const model = tf.keras.Sequential([
        tf.keras.layers.Dense(1, { input_shape: [1] }),
    ]);
    model.compile({ optimizer: "sgd", loss: "mse" });

    const X = np.array(xs).reshape(-1, 1);
    const Y = np.array(ys);
    model.fit(X, Y, { epochs: 200, verbose: 0 });
    return model;
}

const model = trainLinear([1, 2, 3, 4], [2, 4, 6, 8]);
console.log(model.predict(np.array([[10]])));
`,
  },
  {
    name: "PyTorch — gradient descent step",
    ts: `// @typethon target: python
// @typethon import: torch

function step(w: any, x: any, y: any, lr: number): any {
    const pred = w * x;
    const loss = (pred - y) * (pred - y);
    loss.backward();
    return w - lr * w.grad;
}

const w = torch.tensor(0.5, { requires_grad: true });
const x = torch.tensor(2.0);
const y = torch.tensor(4.0);
const updated = step(w, x, y, 0.1);
console.log(updated);
`,
  },
  {
    name: "CUDA via CuPy — GPU dot product",
    ts: `// @typethon target: python
// @typethon import: cupy as cp

function gpuDot(a: number[], b: number[]): number {
    const x = cp.asarray(a);
    const y = cp.asarray(b);
    return cp.dot(x, y);
}

const result = gpuDot([1, 2, 3], [4, 5, 6]);
console.log(result);
`,
  },
  {
    name: "pandas — group and aggregate",
    ts: `// @typethon target: python
// @typethon import: pandas as pd

function groupMean(rows: any[], by: string, value: string): any {
    const df = pd.DataFrame(rows);
    return df.groupby(by)[value].mean();
}

const rows = [
    { region: "north", sales: 10 },
    { region: "north", sales: 20 },
    { region: "south", sales: 5 },
];
console.log(groupMean(rows, "region", "sales"));
`,
  },
  {
    name: "scikit-learn — fit and predict",
    ts: `// @typethon target: python
// @typethon import: numpy as np
// @typethon import: sklearn.linear_model as lm

function fitLine(xs: number[], ys: number[]): any {
    const X = np.array(xs).reshape(-1, 1);
    const y = np.array(ys);
    const model = lm.LinearRegression();
    model.fit(X, y);
    return model;
}

const model = fitLine([1, 2, 3, 4], [3, 5, 7, 9]);
console.log(model.predict(np.array([[5]])));
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
