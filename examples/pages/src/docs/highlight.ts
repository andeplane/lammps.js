// Minimal JavaScript syntax highlighter for the docs editor overlay.
// Tokenizes comments, strings, template literals, keywords, numbers and
// function calls; everything else passes through escaped.

const KEYWORDS = new Set([
  "await",
  "async",
  "const",
  "let",
  "var",
  "function",
  "return",
  "if",
  "else",
  "for",
  "while",
  "of",
  "in",
  "new",
  "try",
  "catch",
  "finally",
  "throw",
  "import",
  "from",
  "export",
  "class",
  "true",
  "false",
  "null",
  "undefined",
  "typeof",
  "break",
  "continue"
]);

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function span(cls: string, text: string): string {
  return `<span class="${cls}">${escapeHtml(text)}</span>`;
}

export function highlight(code: string): string {
  let out = "";
  let i = 0;
  const n = code.length;

  while (i < n) {
    const ch = code[i];
    const next = code[i + 1];

    // line comment
    if (ch === "/" && next === "/") {
      let j = code.indexOf("\n", i);
      if (j === -1) j = n;
      out += span("tok-com", code.slice(i, j));
      i = j;
      continue;
    }

    // block comment
    if (ch === "/" && next === "*") {
      let j = code.indexOf("*/", i + 2);
      j = j === -1 ? n : j + 2;
      out += span("tok-com", code.slice(i, j));
      i = j;
      continue;
    }

    // template literal (kept as one token; LAMMPS scripts live here)
    if (ch === "`") {
      let j = i + 1;
      while (j < n && code[j] !== "`") {
        if (code[j] === "\\") j += 1;
        j += 1;
      }
      j = Math.min(j + 1, n);
      out += span("tok-tpl", code.slice(i, j));
      i = j;
      continue;
    }

    // string
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n && code[j] !== ch && code[j] !== "\n") {
        if (code[j] === "\\") j += 1;
        j += 1;
      }
      j = Math.min(j + 1, n);
      out += span("tok-str", code.slice(i, j));
      i = j;
      continue;
    }

    // number
    if (/[0-9]/.test(ch) && !/[\w$]/.test(code[i - 1] ?? "")) {
      let j = i;
      while (j < n && /[0-9a-fA-FxXoObBeE._+-]/.test(code[j])) {
        // stop +/- unless directly after an exponent marker
        if ((code[j] === "+" || code[j] === "-") && !/[eE]/.test(code[j - 1])) break;
        j += 1;
      }
      out += span("tok-num", code.slice(i, j));
      i = j;
      continue;
    }

    // identifier / keyword / function call
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < n && /[\w$]/.test(code[j])) j += 1;
      const word = code.slice(i, j);
      if (KEYWORDS.has(word)) {
        out += span("tok-kw", word);
      } else if (code[j] === "(") {
        out += span("tok-fn", word);
      } else {
        out += escapeHtml(word);
      }
      i = j;
      continue;
    }

    out += escapeHtml(ch);
    i += 1;
  }

  return out;
}
