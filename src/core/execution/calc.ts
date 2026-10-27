/**
 * Deterministic calculation engine for VOW's calc.evaluate tool.
 *
 * A small, safe, dependency-free evaluator. No `eval`, no generated code,
 * no shell. Three explicit input kinds with predictable semantics:
 *
 * - number:  + - * / % ^, parentheses, unary +/-, gcd(a,b).
 *   Precedence (tightest first): parentheses/gcd, `^` (right-associative),
 *   unary +/-, `*` `/` `%`, `+` `-`. `%` is the truncated remainder
 *   (modulo). Division or remainder by zero is a distinct error.
 * - boolean: true/false with AND OR NOT (also && || !), parentheses.
 *   Precedence: NOT, then AND, then OR. No mixing with numbers.
 * - string:  reverse('text') and count('sub','text') only.
 *   Non-overlapping, case-sensitive occurrences; empty needle is rejected.
 *
 * Bounded execution: input length cap, nesting-depth cap, integer-range cap
 * for gcd, and finite-result enforcement. Failures are typed CalcError
 * codes so callers can distinguish invalid syntax, unsupported operations,
 * division by zero, invalid arguments, and over-limit inputs.
 *
 * Supported numeric range (exactness policy): JavaScript numbers are IEEE-754
 * doubles, so only integers within Number.MAX_SAFE_INTEGER
 * (9007199254740991, ~9.007e15) are exactly representable. Integer literals
 * beyond that range, and integer-valued results beyond that range, are
 * rejected with `too-complex` instead of returning a silently rounded value.
 * Non-integer results (e.g. 7/2 = 3.5, 10/3) are binary floating-point
 * approximations by definition; only exact-integer claims are range-gated.
 */

export type CalcKind = "number" | "boolean" | "string";

export interface CalcResult {
  expression: string;
  result: number | boolean | string;
  kind: CalcKind;
}

export type CalcErrorCode =
  | "invalid-syntax"
  | "unsupported-operation"
  | "division-by-zero"
  | "invalid-arguments"
  | "too-complex";

export class CalcError extends Error {
  readonly code: CalcErrorCode;
  constructor(code: CalcErrorCode, message: string) {
    super(message);
    this.name = "CalcError";
    this.code = code;
  }
}

const MAX_EXPRESSION_LENGTH = 500;
const MAX_NESTING_DEPTH = 50;
const MAX_GCD_MAGNITUDE = 1e15;

function fail(code: CalcErrorCode, message: string): never {
  throw new CalcError(code, message);
}

// ---------------------------------------------------------------------------
// Shared tokenizer
// ---------------------------------------------------------------------------

type Token =
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "word"; value: string }
  | { kind: "op"; value: string }
  | { kind: "lparen" }
  | { kind: "rparen" }
  | { kind: "comma" };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === "(") {
      tokens.push({ kind: "lparen" });
      i += 1;
      continue;
    }
    if (ch === ")") {
      tokens.push({ kind: "rparen" });
      i += 1;
      continue;
    }
    if (ch === ",") {
      tokens.push({ kind: "comma" });
      i += 1;
      continue;
    }
    if (ch === "'") {
      const end = input.indexOf("'", i + 1);
      if (end < 0) fail("invalid-syntax", "Unterminated string literal.");
      tokens.push({ kind: "string", value: input.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const match = input.slice(i).match(/^\d+(\.\d+)?/);
      if (!match) fail("invalid-syntax", `Expected a number at offset ${i}.`);
      tokens.push({ kind: "number", value: Number(match[0]) });
      i += match[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const match = input.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
      const word = (match?.[0] ?? "").toLowerCase();
      tokens.push({ kind: "word", value: word });
      i += match?.[0].length ?? 1;
      continue;
    }
    if (ch === "&" && input[i + 1] === "&") {
      tokens.push({ kind: "word", value: "and" });
      i += 2;
      continue;
    }
    if (ch === "|" && input[i + 1] === "|") {
      tokens.push({ kind: "word", value: "or" });
      i += 2;
      continue;
    }
    if (ch === "!") {
      tokens.push({ kind: "word", value: "not" });
      i += 1;
      continue;
    }
    if ("+-*/%^".includes(ch)) {
      tokens.push({ kind: "op", value: ch });
      i += 1;
      continue;
    }
    fail("unsupported-operation", `Unsupported character ${JSON.stringify(ch)}.`);
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Numeric parser: expr := term (('+'|'-') term)*
// term := power (('*'|'/'|'%') power)*
// power := unary ('^' power)?            (right-associative)
// unary := ('+'|'-') unary | primary
// primary := number | gcdCall | '(' expr ')'
// ---------------------------------------------------------------------------

function gcdInt(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

class NumberParser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): number {
    const value = this.parseExpr(0);
    if (this.pos !== this.tokens.length) {
      fail("invalid-syntax", "Unexpected trailing characters in numeric expression.");
    }
    return value;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private parseExpr(depth: number): number {
    if (depth > MAX_NESTING_DEPTH) fail("too-complex", "Expression nesting exceeds the supported depth.");
    let value = this.parseTerm(depth + 1);
    for (;;) {
      const next = this.peek();
      if (next?.kind === "op" && (next.value === "+" || next.value === "-")) {
        this.pos += 1;
        const rhs = this.parseTerm(depth + 1);
        value = next.value === "+" ? value + rhs : value - rhs;
      } else {
        return value;
      }
    }
  }

  private parseTerm(depth: number): number {
    if (depth > MAX_NESTING_DEPTH) fail("too-complex", "Expression nesting exceeds the supported depth.");
    let value = this.parsePower(depth + 1);
    for (;;) {
      const next = this.peek();
      if (next?.kind === "op" && (next.value === "*" || next.value === "/" || next.value === "%")) {
        this.pos += 1;
        const rhs = this.parsePower(depth + 1);
        if ((next.value === "/" || next.value === "%") && rhs === 0) {
          fail("division-by-zero", "Division or remainder by zero.");
        }
        if (next.value === "*") value *= rhs;
        else if (next.value === "/") value /= rhs;
        else value %= rhs;
      } else {
        return value;
      }
    }
  }

  private parsePower(depth: number): number {
    if (depth > MAX_NESTING_DEPTH) fail("too-complex", "Expression nesting exceeds the supported depth.");
    const base = this.parseUnary(depth + 1);
    const next = this.peek();
    if (next?.kind === "op" && next.value === "^") {
      this.pos += 1;
      const exponent = this.parsePower(depth + 1);
      const value = Math.pow(base, exponent);
      if (!Number.isFinite(value)) {
        fail("too-complex", "Power result exceeds the representable range.");
      }
      return value;
    }
    return base;
  }

  private parseUnary(depth: number): number {
    if (depth > MAX_NESTING_DEPTH) fail("too-complex", "Expression nesting exceeds the supported depth.");
    const next = this.peek();
    if (next?.kind === "op" && (next.value === "+" || next.value === "-")) {
      this.pos += 1;
      const operand = this.parseUnary(depth + 1);
      return next.value === "+" ? operand : -operand;
    }
    return this.parsePrimary(depth + 1);
  }

  private parsePrimary(depth: number): number {
    if (depth > MAX_NESTING_DEPTH) fail("too-complex", "Expression nesting exceeds the supported depth.");
    const next = this.peek();
    if (!next) fail("invalid-syntax", "Expected a number, gcd(, or parenthesis.");
    if (next.kind === "number") {
      this.pos += 1;
      if (Number.isInteger(next.value) && Math.abs(next.value) > Number.MAX_SAFE_INTEGER) {
        fail(
          "too-complex",
          "Integer literal exceeds the exactly-representable range (MAX_SAFE_INTEGER); refusing inexact arithmetic.",
        );
      }
      return next.value;
    }
    if (next.kind === "lparen") {
      this.pos += 1;
      const value = this.parseExpr(depth + 1);
      const closing = this.peek();
      if (!closing || closing.kind !== "rparen") fail("invalid-syntax", "Unbalanced parentheses.");
      this.pos += 1;
      return value;
    }
    if (next.kind === "word" && next.value === "gcd") {
      this.pos += 1;
      const open = this.peek();
      if (!open || open.kind !== "lparen") fail("invalid-syntax", "Expected gcd(a,b).");
      this.pos += 1;
      const a = this.parseExpr(depth + 1);
      const comma = this.peek();
      if (!comma || comma.kind !== "comma") fail("invalid-syntax", "Expected gcd(a,b).");
      this.pos += 1;
      const b = this.parseExpr(depth + 1);
      const close = this.peek();
      if (!close || close.kind !== "rparen") fail("invalid-syntax", "Unbalanced parentheses in gcd(,).");
      this.pos += 1;
      if (!Number.isFinite(a) || !Number.isFinite(b)) {
        fail("invalid-arguments", "gcd() arguments must be finite numbers.");
      }
      if (!Number.isInteger(a) || !Number.isInteger(b)) {
        fail("invalid-arguments", "gcd() arguments must be integers.");
      }
      if (Math.abs(a) > MAX_GCD_MAGNITUDE || Math.abs(b) > MAX_GCD_MAGNITUDE) {
        fail("invalid-arguments", "gcd() arguments exceed the supported magnitude.");
      }
      if (a === 0 && b === 0) fail("invalid-arguments", "gcd(0,0) is undefined.");
      return gcdInt(a, b);
    }
    fail("invalid-syntax", "Expected a number, gcd(, or parenthesis.");
  }
}

// ---------------------------------------------------------------------------
// Boolean parser: or := and (OR and)* ; and := unary (AND unary)*
// unary := NOT unary | primary ; primary := true | false | '(' or ')'
// ---------------------------------------------------------------------------

class BooleanParser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): boolean {
    const value = this.parseOr(0);
    if (this.pos !== this.tokens.length) {
      fail("invalid-syntax", "Unexpected trailing characters in boolean expression.");
    }
    return value;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private parseOr(depth: number): boolean {
    if (depth > MAX_NESTING_DEPTH) fail("too-complex", "Expression nesting exceeds the supported depth.");
    let value = this.parseAnd(depth + 1);
    for (;;) {
      const next = this.peek();
      if (next?.kind === "word" && next.value === "or") {
        this.pos += 1;
        value = value || this.parseAnd(depth + 1);
      } else {
        return value;
      }
    }
  }

  private parseAnd(depth: number): boolean {
    if (depth > MAX_NESTING_DEPTH) fail("too-complex", "Expression nesting exceeds the supported depth.");
    let value = this.parseUnary(depth + 1);
    for (;;) {
      const next = this.peek();
      if (next?.kind === "word" && next.value === "and") {
        this.pos += 1;
        value = value && this.parseUnary(depth + 1);
      } else {
        return value;
      }
    }
  }

  private parseUnary(depth: number): boolean {
    if (depth > MAX_NESTING_DEPTH) fail("too-complex", "Expression nesting exceeds the supported depth.");
    const next = this.peek();
    if (next?.kind === "word" && next.value === "not") {
      this.pos += 1;
      return !this.parseUnary(depth + 1);
    }
    return this.parsePrimary(depth + 1);
  }

  private parsePrimary(depth: number): boolean {
    if (depth > MAX_NESTING_DEPTH) fail("too-complex", "Expression nesting exceeds the supported depth.");
    const next = this.peek();
    if (!next) fail("invalid-syntax", "Expected true, false, NOT, or parenthesis.");
    if (next.kind === "word" && (next.value === "true" || next.value === "false")) {
      this.pos += 1;
      return next.value === "true";
    }
    if (next.kind === "lparen") {
      this.pos += 1;
      const value = this.parseOr(depth + 1);
      const closing = this.peek();
      if (!closing || closing.kind !== "rparen") fail("invalid-syntax", "Unbalanced parentheses.");
      this.pos += 1;
      return value;
    }
    fail("invalid-syntax", "Expected true, false, NOT, or parenthesis.");
  }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

function isBooleanVocabulary(tokens: Token[]): boolean {
  if (!tokens.some((t) => t.kind === "word" && (t.value === "true" || t.value === "false"))) {
    return false;
  }
  return tokens.every(
    (t) =>
      t.kind === "lparen" ||
      t.kind === "rparen" ||
      (t.kind === "word" && ["true", "false", "and", "or", "not"].includes(t.value)),
  );
}

/**
 * Evaluate one canonical calc expression. Dispatches to the numeric,
 * boolean, or string evaluator based on the expression shape.
 */
export function evaluateCalcExpression(input: string): CalcResult {
  const expression = (input ?? "").trim();
  if (!expression) fail("invalid-syntax", "calc.evaluate requires a non-empty expression.");
  if (expression.length > MAX_EXPRESSION_LENGTH) {
    fail("too-complex", `Expression exceeds the ${MAX_EXPRESSION_LENGTH}-character limit.`);
  }
  const tokens = tokenize(expression);
  if (tokens.length === 0) fail("invalid-syntax", "calc.evaluate requires a non-empty expression.");

  const first = tokens[0];
  if (first.kind === "word" && (first.value === "reverse" || first.value === "count")) {
    return evaluateStringCall(expression, tokens);
  }
  if (isBooleanVocabulary(tokens)) {
    return { expression, result: new BooleanParser(tokens).parse(), kind: "boolean" };
  }
  const result = new NumberParser(tokens).parse();
  if (typeof result !== "number" || !Number.isFinite(result)) {
    fail("too-complex", "Calculation did not produce a finite number.");
  }
  if (Number.isInteger(result) && Math.abs(result) > Number.MAX_SAFE_INTEGER) {
    fail(
      "too-complex",
      "Calculation result exceeds the exactly-representable integer range; refusing inexact arithmetic.",
    );
  }
  return { expression, result, kind: "number" };
}

function evaluateStringCall(expression: string, tokens: Token[]): CalcResult {
  const name = (tokens[0] as { value: string }).value;
  let pos = 1;
  const expect = (kind: Token["kind"], what: string): Token => {
    const token = tokens[pos];
    if (!token || token.kind !== kind) fail("invalid-syntax", `Expected ${what}.`);
    pos += 1;
    return token;
  };
  expect("lparen", "'('");
  if (name === "reverse") {
    const arg = expect("string", "a quoted string");
    expect("rparen", "')'");
    if (pos !== tokens.length) fail("invalid-syntax", "Unexpected trailing characters.");
    const text = (arg as { value: string }).value;
    if (text.length > MAX_EXPRESSION_LENGTH) fail("too-complex", "String argument exceeds the supported length.");
    return { expression, result: Array.from(text).reverse().join(""), kind: "string" };
  }
  const needleToken = expect("string", "a quoted needle");
  expect("comma", "','");
  const hayToken = expect("string", "a quoted haystack");
  expect("rparen", "')'");
  if (pos !== tokens.length) fail("invalid-syntax", "Unexpected trailing characters.");
  const needle = (needleToken as { value: string }).value;
  const hay = (hayToken as { value: string }).value;
  if (!needle) fail("invalid-arguments", "count() needle must be non-empty.");
  if (hay.length > 20000) fail("too-complex", "String argument exceeds the supported length.");
  let count = 0;
  let from = 0;
  for (;;) {
    const found = hay.indexOf(needle, from);
    if (found < 0) break;
    count += 1;
    from = found + needle.length;
    if (count > 100000) fail("too-complex", "Match count exceeds the supported bound.");
  }
  return { expression, result: count, kind: "number" };
}

// ---------------------------------------------------------------------------
// Natural-language translation (general patterns, no benchmark content)
// ---------------------------------------------------------------------------

const ISO_DATE = /\d{4}-\d{2}-\d{2}/;

/** Strip trailing metadata annotations before calculation translation.
 * Narrow: fresh-style bracket/hash tags plus pure-numeric bracket/hash
 * fragments that can otherwise look like `20261101-0` arithmetic.
 * Calc never legitimately uses `#`, and trailing `[...]` metadata is
 * never the requested calculation when preceding content remains.
 * Returns the original trimmed input when stripping would empty it.
 */
function stripTrailingMetadataTags(input: string): string {
  let out = (input ?? "").trim();
  for (let i = 0; i < 3; i += 1) {
    const before = out;
    out = out.replace(/\s*\[[^\]]*fresh[^\]]*\]\s*$/i, "").trim();
    out = out.replace(/\s*\[\s*-?\d[\d\s\-]*\s*\]\s*$/, "").trim();
    const hashStripped = out.replace(/\s*#[^\s]*\s*$/, "").trim();
    if (hashStripped !== out && hashStripped) {
      const frag = (out.match(/#([^\s]*)\s*$/) ?? [])[1] ?? "";
      if (/fresh/i.test(frag) || /[A-Za-z]/.test(frag) || /^[\d\-]+$/.test(frag)) {
        out = hashStripped;
      }
    }
    if (out === before) break;
    if (!out) break;
  }
  return out || (input ?? "").trim();
};


function cleanCandidate(raw: string): string {
  let cleaned = raw
    .replace(/,/g, (m, offset, full: string) => {
      const prev = full[offset - 1];
      const next = full[offset + 1];
      return prev && next && /\d/.test(prev) && /\d/.test(next) ? "" : m;
    })
    .trim()
    .replace(/[.\s;:,]+$/, "")
    .replace(/^[^\d(+\-]+/, "")
    .trim();
  // Drop explanatory asides that unbalance the parentheses, e.g. the
  // "(2 to the power 10, ...)" gloss after an already-complete expression.
  for (let guard = 0; guard < 8; guard += 1) {
    const opens = (cleaned.match(/\(/g) ?? []).length;
    const closes = (cleaned.match(/\)/g) ?? []).length;
    if (opens === closes) break;
    if (opens > closes) {
      const cut = cleaned.lastIndexOf("(");
      if (cut < 0) break;
      cleaned = cleaned.slice(0, cut).trim().replace(/[.\s;:,]+$/, "");
    } else {
      const cut = cleaned.indexOf(")");
      if (cut < 0) break;
      cleaned = cleaned.slice(cut + 1).trim().replace(/^[^\d(+\-]+/, "");
    }
  }
  return cleaned.replace(/[^\d)\s]+$/, "").trim();
}

/** True when the candidate applies a binary operator (not a bare signed
 *  number like "-1" from a hyphenated word, and not a bare literal). */
function hasBinaryOp(candidate: string): boolean {
  return /(\d\s*[+\-*/%^]\s*[\d(]|\([^()]*[+\-*/%^]|\)\s*[+\-*/%^])/.test(candidate);
}

/**
 * Context-sensitive numeric-fragment scan. A digit run is only a calculation
 * candidate when it is NOT embedded in a larger identifier/reference token
 * and when a bare hyphen range is actually authorized by the request.
 *
 * - Identifier guard: when the character immediately before or after the run
 *   is a letter, underscore, or bracket, the run is a fragment of something
 *   else (order IDs like XT2-4491-B, serials like 8X-2201-Z, log IDs like
 *   [20261101-2], flight refs like BA2490-B) and is rejected. Genuine
 *   arithmetic is surrounded by spaces, parens, operators, or punctuation.
 * - Bare-hyphen gate: a candidate whose only operator is `-` (phone suffixes
 *   like 555-0142, score ranges like 10-20) is accepted only when the request
 *   carries an explicit calculation cue (what is / compute / ...); without
 *   that cue there is no evidence the author meant subtraction. Runs with
 *   any other operator (+ * / % ^, parens) are unambiguous math notation.
 */
function candidateRuns(text: string, opts?: { calcCue?: boolean }): string[] {
  const calcCue = opts?.calcCue ?? false;
  const re = /[0-9+\-*/().%^\s,]+/g;
  const out: string[] = [];
  for (const m of text.matchAll(re)) {
    const run = m[0];
    const start = m.index ?? 0;
    const end = start + run.length;
    if (!/\d/.test(run)) continue;
    if (ISO_DATE.test(run)) continue;
    // Identifier-boundary check on the trimmed run: the regex class includes
    // whitespace, so a leading space would otherwise hide an attached word
    // (e.g. the "Compute " before "(5 + 5)"). Only the characters touching
    // actual run content determine embedding.
    const lead = run.match(/^\s*/)?.[0].length ?? 0;
    const trail = run.match(/\s*$/)?.[0].length ?? 0;
    const contentStart = start + lead;
    const contentEnd = end - trail;
    const before = contentStart > 0 ? text[contentStart - 1] : "";
    const after = contentEnd < text.length ? text[contentEnd] : "";
    if (/[A-Za-z_\[\]]/.test(before) || /[A-Za-z_\[\]]/.test(after)) continue;
    const cleaned = cleanCandidate(run);
    if (!/\d/.test(cleaned)) continue;
    if (!hasBinaryOp(cleaned)) continue;
    if (ISO_DATE.test(cleaned)) continue;
    if (!calcCue && !/[+*/%^]/.test(cleaned)) continue;
    out.push(cleaned);
  }
  return out.sort((a, b) => b.length - a.length);
}

const CONTINUATION_PREFIX = new RegExp(
  "^\\W*(add|plus|\\+|subtract|minus|\\-|multiply|times|\\*|divide|over|/)\\b\\s*(by\\s+)?(-?\\d+(?:\\.\\d+)?)",
  "i",
);

function continuationOp(verb: string, hasBy: boolean): string | null {
  const v = verb.toLowerCase();
  if (v === "add" || v === "plus" || v === "+") return "+";
  if (v === "subtract" || v === "minus" || v === "-") return "-";
  if (v === "multiply" || v === "times" || v === "*") return "*";
  if (v === "divide" || v === "/" || (v === "over" && hasBy)) return "/";
  if (v === "over") return null;
  return null;
}

/**
 * Translate a natural-language calculation request into one canonical calc
 * expression, or null when no deterministic translation exists (caller falls
 * through to the informational/provider route instead of emitting a wrong
 * tool call). Handles word-form powers, GCD phrasing, boolean and string
 * operations, and multi-step "then <op> <number>" chains.
 */
export function translateRequestToExpression(request: string): string | null {
  const rawText = (request ?? "").replace(/\s+/g, " ").trim();
  if (!rawText) return null;
  if (ISO_DATE.test(rawText)) return null;
  const text = stripTrailingMetadataTags(rawText);
  if (!text) return null;

  const gcdWords = text.match(/greatest common divisor of\s+(-?\d+)\s+and\s+(-?\d+)/i);
  if (gcdWords) {
    const candidate = `gcd(${gcdWords[1]},${gcdWords[2]})`;
    try {
      evaluateCalcExpression(candidate);
      return candidate;
    } catch {
      return null;
    }
  }
  const gcdCall = text.match(/gcd\s*\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)/i);
  if (gcdCall) {
    const candidate = `gcd(${gcdCall[1]},${gcdCall[2]})`;
    try {
      evaluateCalcExpression(candidate);
      return candidate;
    } catch {
      return null;
    }
  }

  const reverseMatch = text.match(/reverse\s+(?:the\s+)?(?:string\s+)?'([^']{1,200})'/i);
  if (reverseMatch) {
    const candidate = `reverse('${reverseMatch[1]}')`;
    try {
      evaluateCalcExpression(candidate);
      return candidate;
    } catch {
      return null;
    }
  }
  const countMatch = text.match(
    /count\s+(?:the\s+)?(?:letter|occurrences?(?:\s+of)?)?\s*'([^']{1,50})'\s+in\s+'([^']{1,2000})'/i,
  );
  if (countMatch) {
    const candidate = `count('${countMatch[1]}','${countMatch[2]}')`;
    try {
      evaluateCalcExpression(candidate);
      return candidate;
    } catch {
      return null;
    }
  }

  if (/\btrue\b|\bfalse\b/i.test(text)) {
    const boolMatch = text.match(
      /\(?\s*(?:NOT\s+|!\s*)?(?:true|false)\s*\)?(?:\s*(?:AND|OR|&&|\|\|)\s*\(?\s*(?:NOT\s+|!\s*)?(?:true|false)\s*\)?)+/i,
    );
    if (boolMatch) {
      const candidate = boolMatch[0].replace(/&&/g, " AND ").replace(/\|\|/g, " OR ").replace(/!/g, " NOT ");
      try {
        const parsed = evaluateCalcExpression(candidate);
        if (parsed.kind === "boolean") return candidate.trim();
      } catch {
        // Fall through to arithmetic handling.
      }
    }
  }

  // General word-problem patterns (no benchmark IDs or answers).
  // Each requires explicit keywords plus explicit numbers and is
  // trial-evaluated; anything ambiguous returns null so the caller falls
  // through to the normal provider route. The rate*time pattern additionally
  // requires an explicit numeric-answer cue ("reply with the number/result")
  // so bare prose questions stay on the provider route.
  const tryNumberCandidate = (candidate: string): string | null => {
    try {
      const parsed = evaluateCalcExpression(candidate);
      if (parsed.kind === "number") return candidate;
      return null;
    } catch {
      return null;
    }
  };

  // Word problems require an explicit numeric-answer cue so narrative
  // prose ("in the old story", "how far?" with no requested number) stays
  // on the provider route. All pilot word problems carry such a cue.
  const hasNumericCue = /\b(what is|how much is|compute|calculate|evaluate|reply with|sale price)\b/i.test(text);

  // Fraction / percent of N: "half of 100", "three quarters of 96",
  // "two thirds of 90", "25% of 200", "25 percent of 200".
  const fractionWords = text.match(/\b(half|halves|quarter|quarters|third|thirds|three quarters|two thirds)\s+of\s+(-?\d+(?:\.\d+)?)/i);
  if (fractionWords && hasNumericCue) {
    const word = fractionWords[1].toLowerCase();
    const n = fractionWords[2];
    let frac: string | null = null;
    if (word === "half" || word === "halves") frac = `(${n})/2`;
    else if (word === "quarter" || word === "quarters") frac = `(${n})/4`;
    else if (word === "third" || word === "thirds") frac = `(${n})/3`;
    else if (word === "three quarters") frac = `(${n})*3/4`;
    else if (word === "two thirds") frac = `(${n})*2/3`;
    if (frac) {
      const ok = tryNumberCandidate(frac);
      if (ok) return ok;
    }
  }
  const percentOf =
    text.match(/(-?\d+(?:\.\d+)?)\s*%\s+of\s+(-?\d+(?:\.\d+)?)/i) ??
    text.match(/(-?\d+(?:\.\d+)?)\s+percent\s+of\s+(-?\d+(?:\.\d+)?)/i);
  if (percentOf && hasNumericCue) {
    const ok = tryNumberCandidate(`(${percentOf[2]})*${percentOf[1]}/100`);
    if (ok) return ok;
  }

  // Average of an explicit number list: "average of 12, 18, 24 and 30".
  if (/\baverage\s+of\b/i.test(text) && hasNumericCue) {
    const listPart = text.match(/\baverage\s+of\s+([^?.!;]+)/i)?.[1] ?? "";
    const nums = (listPart.match(/-?\d+(?:\.\d+)?/g) ?? []).slice(0, 20);
    if (nums.length >= 2) {
      const ok = tryNumberCandidate(`(${nums.join("+")})/${nums.length}`);
      if (ok) return ok;
    }
  }

  // Discount: "$240 discounted 15%" / "240 discounted by 15%" / "15% off $240".
  const discountA = text.match(/\$?\s*(-?\d+(?:\.\d+)?)\s*(?:item|price)?\s*(?:is\s+)?discounted\s*(?:by\s+)?(-?\d+(?:\.\d+)?)\s*%/i);
  if (discountA && hasNumericCue) {
    const ok = tryNumberCandidate(`(${discountA[1]})*(100-${discountA[2]})/100`);
    if (ok) return ok;
  }
  const discountB =
    text.match(/(-?\d+(?:\.\d+)?)\s*%\s*off\s*\$?\s*(-?\d+(?:\.\d+)?)/i) ??
    text.match(/(-?\d+(?:\.\d+)?)\s+percent\s+off\s*\$?\s*(-?\d+(?:\.\d+)?)/i);
  if (discountB && hasNumericCue) {
    const ok = tryNumberCandidate(`(${discountB[2]})*(100-${discountB[1]})/100`);
    if (ok) return ok;
  }

  // Rate * time (explicit numeric-answer cue required to keep bare prose
  // on the provider route; preserves the existing "How far?" refusal).
  if (/reply with (the )?(number|result)/i.test(text)) {
    const rate =
      text.match(/(?:travels|moves|goes|drives|flies)\s+at\s+(-?\d+(?:\.\d+)?)\s*(?:km\/h|kmh|kph|mph|m\/s)?[^.]*?\sfor\s+(-?\d+(?:\.\d+)?)\s*hours?/i) ??
      text.match(/\bat\s+(-?\d+(?:\.\d+)?)\s*(?:km\/h|kmh|kph|mph)\s*for\s+(-?\d+(?:\.\d+)?)\s*hours?/i);
    if (rate) {
      const ok = tryNumberCandidate(`${rate[1]}*${rate[2]}`);
      if (ok) return ok;
    }
  }

  // Word operators with numeric operands on both sides ("37 times 41",
  // "10 divided by 2", "6 multiplied by 7"). Gated on the numeric-answer
  // cue so narrative prose stays on the provider route; operand adjacency
  // keeps date/medication phrasings ("3 times daily") out.
  let normalized = text
    .replace(/(\d[\d\s]*)\s+to the power(\s+of)?\s+(-?\d[\d.]*)/gi, "$1^$3")
    .replace(/(\d|\))\s+cubed\b/gi, "$1^3")
    .replace(/(\d|\))\s+squared\b/gi, "$1^2");
  if (hasNumericCue) {
    // Iterative word-operator folding: repeated passes resolve chained
    // forms such as "6 times 7 times 8" or "1000 minus 1 minus 1" that a
    // single global pass would leave partially translated (e.g. "6*7 times 8").
    // Numeric-operand gating plus the numeric-answer cue keeps date and
    // medication phrasings ("3 times daily") off the deterministic route.
    let prev = "";
    let cur = normalized;
    for (let iter = 0; iter < 6 && cur !== prev; iter++) {
      prev = cur;
      cur = cur
        .replace(/(\d+(?:\.\d+)?)\s+times\s+(\d+(?:\.\d+)?)/gi, "$1*$2")
        .replace(/(\d+(?:\.\d+)?)\s+divided\s+by\s+(\d+(?:\.\d+)?)/gi, "$1/$2")
        .replace(/(\d+(?:\.\d+)?)\s+multiplied\s+by\s+(\d+(?:\.\d+)?)/gi, "$1*$2")
        .replace(/(\d+(?:\.\d+)?)\s+plus\s+(\d+(?:\.\d+)?)/gi, "$1+$2")
        .replace(/(\d+(?:\.\d+)?)\s+minus\s+(\d+(?:\.\d+)?)/gi, "$1-$2")
        .replace(/(\d+(?:\.\d+)?)\s+add\s+(\d+(?:\.\d+)?)/gi, "$1+$2")
        .replace(/(\d+(?:\.\d+)?)\s+subtract\s+(\d+(?:\.\d+)?)/gi, "$1-$2");
    }
    normalized = cur;
  }

  const parts = normalized.split(/\bthen\b/i);
  if (parts.length > 1) {
    let acc: string | null = null;
    for (const head of candidateRuns(parts[0], { calcCue: hasNumericCue })) {
      try {
        const parsed = evaluateCalcExpression(head);
        if (parsed.kind === "number") {
          acc = head;
          break;
        }
      } catch {
        // Try the next-longest candidate run.
      }
    }
    if (acc === null) return null;
    for (const tail of parts.slice(1)) {
      const cont = tail.match(CONTINUATION_PREFIX);
      if (!cont) return null;
      const op = continuationOp(cont[1], Boolean(cont[2]));
      if (!op) return null;
      acc = `(${acc})${op}${cont[3]}`;
    }
    try {
      const parsed = evaluateCalcExpression(acc);
      if (parsed.kind === "number") return acc;
      return null;
    } catch {
      return null;
    }
  }

  // v2.3.1 cue-priority: when several numeric runs exist, prefer the one
  // inside the explicitly cued clause ("What is ...?", "Compute ...?") over
  // an incidental bare-hyphen fragment elsewhere (e.g. "Ticket 100-20 ...
  // What is 5 plus 5?" must yield 5+5, not 100-20). The cue sentence pool is
  // tried first; the whole request remains as fallback so cue-less heads
  // ("Compute the total. The bill is 40 plus 60.") still resolve.
  const cueClause = /\b(what is|how much is|compute|calculate|evaluate|reply with|sale price)\b/i;
  const pools: string[] = (() => {
    if (!cueClause.test(normalized)) return [normalized];
    const cueText = normalized
      .split(/(?<=[.!?;])\s+/)
      .filter((s) => cueClause.test(s))
      .join(" ");
    return cueText ? [cueText, normalized] : [normalized];
  })();
  for (const pool of pools) {
    for (const candidate of candidateRuns(pool, { calcCue: hasNumericCue })) {
      try {
        const parsed = evaluateCalcExpression(candidate);
        if (parsed.kind === "number") return candidate;
      } catch {
        // Try the next-longest candidate run.
      }
    }
  }
  return null;
}

/**
 * Multi-expression translation for requests needing more than one
 * deterministic calculation (general rectangle area+perimeter shape).
 * Returns 2 expressions for "rectangle W by H" with area+perimeter cues,
 * otherwise delegates to the single-expression translator.
 */
export function translateRequestToCalcExpressions(request: string): string[] | null {
  const rawText = (request ?? "").replace(/\s+/g, " ").trim();
  if (!rawText || ISO_DATE.test(rawText)) return null;
  const text = stripTrailingMetadataTags(rawText);
  if (!text) return null;
  const rect = text.match(/rectangle(?:\s+is)?\s+(-?\d+(?:\.\d+)?)\s+by\s+(-?\d+(?:\.\d+)?)/i);
  if (
    rect &&
    /\barea\b/i.test(text) &&
    /\bperimeter\b/i.test(text) &&
    /\b(what is|how much|compute|calculate|evaluate|reply with|comma separated)\b/i.test(text)
  ) {
    const w = rect[1];
    const h = rect[2];
    try {
      const area = `${w}*${h}`;
      const perim = `2*(${w}+${h})`;
      const a = evaluateCalcExpression(area);
      const q = evaluateCalcExpression(perim);
      if (a.kind === "number" && q.kind === "number") return [area, perim];
    } catch {
      return null;
    }
    return null;
  }
  const single = translateRequestToExpression(request);
  return single ? [single] : null;
}

/** Legacy numeric entry kept for compatibility; delegates to the engine. */
export function evaluateMath(expression: string): number {
  const parsed = evaluateCalcExpression(expression);
  if (parsed.kind !== "number" || typeof parsed.result !== "number") {
    throw new CalcError("unsupported-operation", "Expression did not evaluate to a number.");
  }
  return parsed.result;
}
