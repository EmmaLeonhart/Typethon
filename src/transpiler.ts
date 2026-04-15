/**
 * TypeScript -> Python transpiler (TypeScript port).
 *
 * Mirrors the Python reference implementation in ``typethon/transpiler.py``.
 * The output is a compilation artifact, not idiomatic Python -- the goal
 * is just to be valid Python so library imports work.
 */

const TYPE_MAP: Record<string, string> = {
  number: "float",
  string: "str",
  boolean: "bool",
  bigint: "int",
  void: "None",
  null: "None",
  undefined: "None",
  any: "Any",
  unknown: "Any",
  never: "Any",
  object: "dict",
};

const IDENT_REPLACEMENTS: Record<string, string> = {
  true: "True",
  false: "False",
  null: "None",
  undefined: "None",
};

const OPERATOR_REPLACEMENTS: Array<[string, string]> = [
  ["===", "=="],
  ["!==", "!="],
  ["&&", " and "],
  ["||", " or "],
];

export interface Pragma {
  target: string;
  imports: string[];
}

function parsePragmas(source: string): Pragma {
  const pragma: Pragma = { target: "python", imports: [] };
  for (const rawLine of source.split("\n")) {
    const stripped = rawLine.trim();
    if (!stripped) continue;
    if (!stripped.startsWith("//")) break;
    const body = stripped.slice(2).trim();
    if (!body.startsWith("@typethon")) continue;
    const directive = body.slice("@typethon".length).trim().replace(/^:/, "").trim();
    if (directive.startsWith("target")) {
      const value = directive.split(":").slice(1).join(":").trim();
      if (value) pragma.target = value;
    } else if (directive.startsWith("import")) {
      const value = directive.split(":").slice(1).join(":").trim();
      if (value) pragma.imports.push(value);
    }
  }
  return pragma;
}

function stripStringsAndComments(source: string): { text: string; placeholders: Map<string, string> } {
  const placeholders = new Map<string, string>();
  let counter = 0;
  const stash = (value: string): string => {
    const key = `__TYPETHON_TOK_${counter++}__`;
    placeholders.set(key, value);
    return key;
  };

  const out: string[] = [];
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    // Line comment.
    if (ch === "/" && source[i + 1] === "/") {
      let end = source.indexOf("\n", i);
      if (end === -1) end = n;
      const comment = source.slice(i, end);
      out.push(stash("#" + comment.slice(2)));
      i = end;
      continue;
    }
    // Block comment.
    if (ch === "/" && source[i + 1] === "*") {
      let end = source.indexOf("*/", i + 2);
      end = end === -1 ? n : end + 2;
      const block = source.slice(i, end);
      const inner = block.endsWith("*/") ? block.slice(2, -2) : block.slice(2);
      const pyComment = inner
        .split("\n")
        .map((ln) => "# " + ln.replace(/^[ *]+/, ""))
        .join("\n");
      out.push(stash(pyComment));
      i = end;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      let j = i + 1;
      while (j < n) {
        if (source[j] === "\\" && j + 1 < n) {
          j += 2;
          continue;
        }
        if (source[j] === quote) {
          j += 1;
          break;
        }
        j += 1;
      }
      const literal = source.slice(i, j);
      if (quote === "`") {
        const inner = literal.slice(1, -1);
        if (inner.includes("${")) {
          out.push(stash(literal));
        } else {
          out.push(stash('"' + inner.replace(/"/g, '\\"') + '"'));
        }
      } else {
        out.push(stash(literal));
      }
      i = j;
      continue;
    }
    out.push(ch);
    i += 1;
  }
  return { text: out.join(""), placeholders };
}

function restore(text: string, placeholders: Map<string, string>): string {
  for (const [key, value] of placeholders) {
    text = text.split(key).join(value);
  }
  return text;
}

function mapType(tsType: string): string {
  const trimmed = tsType.trim();
  if (!trimmed) return "Any";
  const arrSuffix = trimmed.match(/^(.+)\[\]$/);
  if (arrSuffix) return `list[${mapType(arrSuffix[1])}]`;
  const arrGeneric = trimmed.match(/^Array<(.+)>$/);
  if (arrGeneric) return `list[${mapType(arrGeneric[1])}]`;
  if (trimmed.includes("|") && !trimmed.includes("<")) {
    return trimmed.split("|").map(mapType).join(" | ");
  }
  return TYPE_MAP[trimmed] ?? trimmed;
}

function convertReturnAnnotations(text: string): string {
  return text.replace(/\)\s*:\s*([A-Za-z_][\w<>\[\]\| ,]*?)\s*\{/g, (_m, t: string) => {
    return ") -> " + mapType(t.trim()) + " {";
  });
}

function convertControlFlow(text: string): string {
  // ``else if`` first so ``if`` regex can't eat the inner ``if (...)``.
  text = text.replace(/\}\s*else\s+if\s*\((.*?)\)\s*\{/g, (_m, c: string) => `}\nelif ${c.trim()} {`);
  text = text.replace(/\}\s*else\s*\{/g, "}\nelse {");
  text = text.replace(/\bif\s*\((.*?)\)\s*\{/g, (_m, c: string) => `if ${c.trim()} {`);
  text = text.replace(/\bwhile\s*\((.*?)\)\s*\{/g, (_m, c: string) => `while ${c.trim()} {`);
  text = text.replace(
    /\bfor\s*\(\s*(?:let|const|var)\s+(\w+)\s*=\s*0\s*;\s*\1\s*<\s*([^;]+?)\s*;\s*\1\+\+\s*\)\s*\{/g,
    (_m, v: string, end: string) => `for ${v} in range(${end.trim()}) {`,
  );
  text = text.replace(
    /\bfor\s*\(\s*(?:let|const|var)\s+(\w+)\s+of\s+([^)]+?)\)\s*\{/g,
    (_m, v: string, it: string) => `for ${v} in ${it.trim()} {`,
  );
  return text;
}

function convertFunctionDecls(text: string): string {
  return text.replace(/\bfunction\s+([A-Za-z_]\w*)\s*\(/g, "def $1(");
}

function convertTypeAnnotations(text: string): string {
  return text.replace(/:\s*([A-Za-z_][\w<>\[\]\| ,]*?)(?=[,)=\n{])/g, (_m, t: string) => `: ${mapType(t.trim())}`);
}

function convertVarDecls(text: string): string {
  return text.replace(/\b(?:const|let|var)\s+/g, "");
}

function convertConsole(text: string): string {
  return text.split("console.log").join("print");
}

function convertOperators(text: string): string {
  for (const [src, dst] of OPERATOR_REPLACEMENTS) {
    text = text.split(src).join(dst);
  }
  text = text.replace(/(?<![=!<>])!(?!=)/g, "not ");
  return text;
}

function convertIdentifiers(text: string): string {
  return text.replace(/\b[A-Za-z_]\w*\b/g, (w) => IDENT_REPLACEMENTS[w] ?? w);
}

function stripSemicolons(text: string): string {
  return text.replace(/;\s*(?=\n|$)/g, "");
}

function bracesToIndent(text: string): string {
  const out: string[] = [];
  let indent = 0;
  const pad = "    ";
  for (const rawLine of text.split("\n")) {
    let line = rawLine.replace(/\s+$/, "");
    const stripped = line.trim();
    if (stripped === "}") {
      indent = Math.max(0, indent - 1);
      continue;
    }
    let opens = false;
    if (stripped.endsWith("{")) {
      line = line.slice(0, line.lastIndexOf("{")).replace(/\s+$/, "");
      opens = true;
      if (line && !line.endsWith(":")) line = line + ":";
    }
    while (line.replace(/^\s+/, "").startsWith("}")) {
      indent = Math.max(0, indent - 1);
      line = line.replace(/^\s+/, "").slice(1).replace(/^\s+/, "");
    }
    if (line.trim()) {
      out.push(pad.repeat(indent) + line.trim());
    } else if (opens) {
      out.push(pad.repeat(indent) + "pass");
    }
    if (opens) indent += 1;
  }
  return out.join("\n");
}

export function transpile(source: string): string {
  const pragma = parsePragmas(source);
  let { text, placeholders } = stripStringsAndComments(source);

  text = convertReturnAnnotations(text);
  text = convertControlFlow(text);
  text = convertFunctionDecls(text);
  text = convertTypeAnnotations(text);
  text = convertVarDecls(text);
  text = convertConsole(text);
  text = convertOperators(text);
  text = convertIdentifiers(text);
  text = stripSemicolons(text);
  text = bracesToIndent(text);

  text = restore(text, placeholders);

  const headerLines: string[] = [];
  if (text.split("\n").some((l) => l.includes("Any"))) {
    headerLines.push("from typing import Any");
  }
  for (const imp of pragma.imports) {
    headerLines.push(`import ${imp}`);
  }
  const header = headerLines.join("\n");
  if (header) {
    return header + "\n\n" + text.replace(/^\n+/, "");
  }
  return text.replace(/^\n+/, "");
}
