# VOW Reasoning System
## Mapping (existing → required)
- Task State Graph: NEW `src/core/reasoning/task-graph.ts` built on `AgentTask`+`PlanStep` (task-store, state-machine preserved). Supports acceptance, deps, evidence, assumptions, blockers, checkpoint serialize/restore.
- Cognitive Controller: NEW `controller.ts` pure `decideNext()`; separates reasoning from memory/providers/tools/policy.
- Adaptive Reasoning: NEW `effort.ts` Light/Medium/High/Max/+Max per-subtask budgets; user ceiling caps automatic spend.
- Ledger: NEW `ledger.ts` decision/evidence/tool_outcome/transition/escalation/verification events; no chain-of-thought stored.
- Bounded recovery: NEW `recovery.ts` + `runner.ts`; classify failures, retry ≤2, replan ≤3, escalate denials, honest outcomes (completed/blocked/failed/partial/unverified) grounded in verification + evidence, never model confidence.
## Rules honored
- Memory via injected port (JSON engine interfaces); provider via ReasoningModelPort (provenance recorded, real vs mock distinguished); tools via executor port behind Warden; effort vs authorization separate; retry/tool/model/time bounded.
## Demo
`npx vitest run tests/unit/reasoning tests/integration/reasoning-runner.test.ts`
