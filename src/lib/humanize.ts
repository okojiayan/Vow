/**
 * Plain-language layer for machine-worded agent output.
 * Display-only: never alters data, never hides detail (full text stays
 * one tap away in trace/details views). Falls back to the original string
 * whenever nothing matches, so unknown tools stay honest.
 */

function clean(s: string): string {
  return s.replace(/\[Demo mode\]\s*/g, "").replace(/\[Deterministic plan\]\s*/g, "").trim();
}

/** "Evaluate expression: ({"expression":"12 + 30","result":42})" -> "12 + 30 = 42" */
function calcResult(s: string): string | null {
  const m = s.match(/"expression"\s*:\s*"([^"]+)"\s*,\s*"result"\s*:\s*"?([^",}]+)"?/);
  if (!m) return null;
  return `${m[1]} = ${m[2]}`;
}

function genericResult(s: string): string | null {
  const m = s.match(/"result"\s*:\s*"?([^",}]+)"?/);
  if (!m) return null;
  const action = s.match(/"action"\s*:\s*"([^"]+)"|"tool"\s*:\s*"([^"]+)"/);
  const what = action?.[1] ?? action?.[2];
  return what ? `${what}: ${m[1]}` : `Result: ${m[1]}`;
}

/** User-facing one-liner for a task result summary (may shorten). */
export function humanResult(summary: string | null): string | null {
  if (!summary) return null;
  const s = clean(summary);
  return calcResult(s) ?? genericResult(s) ?? (s.length > 220 ? `${s.slice(0, 217)}…` : s);
}

/** Full assistant message in plain words — never truncated, never lossy. */
export function humanMessage(content: string): string {
  const s = clean(content);
  return calcResult(s) ?? genericResult(s) ?? content;
}

/** Drawer title: the user's own request beats a machine plan label. */
export function humanTitle(planSummary: string | null, request: string): string {
  if (!planSummary) return request;
  const s = clean(planSummary);
  const m = s.match(/^heuristic demo plan for:\s*(.+)$/i);
  if (m) return m[1];
  return s.length > 90 ? request : s;
}

const TOOL_VERBS: Record<string, string> = {
  "calc.evaluate": "Calculated",
  "notes.create": "Created a note",
  "notes.list": "Listed notes",
  "fs.list": "Listed files",
  "fs.read": "Read a file",
  "fs.write": "Wrote a file",
  "fs.delete": "Deleted a file",
  "http.fetch": "Fetched a page",
  "memory.search": "Searched memory",
  "memory.store": "Saved a memory",
  "shell.exec": "Ran a command",
  "run_sql": "Ran a dataset query",
  "memory.json": "Checked memory",
  "memory.revert": "Reverted a memory",
  "memory.forget": "Forgot a memory",
};

export function toolVerb(tool: string): string {
  const name = tool.replace(/^tool\s+/i, "");
  return TOOL_VERBS[name] ?? `Used ${name}`;
}

function humanDetail(kind: string, detail: string): string {
  const calc = calcResult(detail);
  if (calc) return calc;
  if (/meterless is unavailable/i.test(detail)) return "Working offline — using the built-in planner.";
  if (/inspec/i.test(detail)) return "Checked against the actual result.";
  if (/requesting a structured plan/i.test(detail)) return "Drafting a plan for your request.";
  if (/pre-authorized.*still passed the warden gateway/i.test(detail)) return "Routine action — checked and cleared.";
  if (/action-specific approval is required/i.test(detail)) return "Paused here. Nothing runs until you approve the exact action.";
  const g = genericResult(detail);
  if (g) return g;
  return detail.length > 200 ? `${detail.slice(0, 197)}…` : detail;
}

/** Timeline rows: machine event -> human headline + readable detail. */
export function humanEvent(kind: string, title: string, detail: string): { title: string; detail: string } {
  const k = kind.toLowerCase();
  const calc = calcResult(detail) ?? calcResult(title);
  if (calc) {
    if (/complet/i.test(k) || /complet/i.test(title)) return { title: "Done", detail: calc };
    return { title: "Result", detail: calc };
  }
  if (/needs_approval|awaiting/i.test(k) || /approval/i.test(title)) {
    return { title: "Waiting for your approval", detail: humanDetail(kind, detail) || title };
  }
  if (/ask_user|controller/i.test(`${k} ${title}`)) {
    return { title: "Waiting for your input", detail: humanDetail(kind, detail) || "VOW paused to ask you something." };
  }
  if (/unverif|needs review|did not pass/i.test(`${k} ${title} ${detail}`)) {
    return { title: "Needs review", detail: humanDetail(kind, detail) };
  }
  if (/warden.*ok|^warden$/i.test(title) || (k.includes("warden") && !/need|den|block|fail/i.test(k + title))) {
    return { title: "Checked by Warden", detail: humanDetail(kind, detail) };
  }
  if (/den|block/i.test(k + title)) return { title: "Stopped by policy", detail: humanDetail(kind, detail) };
  if (/outcome:\s*unverified/i.test(`${title} ${detail}`)) {
    return { title: "Needs review", detail: humanDetail(kind, detail) };
  }
  if (/verif|pass/i.test(k + title)) return { title: "Verified", detail: humanDetail(kind, detail) };
  if (/fail|error/i.test(k + title)) return { title: "Didn't finish", detail: humanDetail(kind, detail) };
  if (/plan/i.test(k) && !/request/i.test(k)) return { title: "Made a plan", detail: humanDetail(kind, detail) };
  if (/planner request/i.test(title)) return { title: "Planning", detail: humanDetail(kind, detail) };
  if (/tool/i.test(k)) {
    return { title: toolVerb(title), detail: humanDetail(kind, detail) };
  }
  const t = clean(title);
  return { title: t.charAt(0).toUpperCase() + t.slice(1), detail: humanDetail(kind, detail) };
}

/** Verification line in plain words. */
export function humanVerification(passed: boolean | null, explanation: string): string {
  const what = /inspec/i.test(explanation) ? "Checked against the actual result." : explanation;
  if (passed === true) return `Verified — ${what}`;
  if (passed === false) return `Needs review — ${what}`;
  return `Check pending — ${what}`;
}
