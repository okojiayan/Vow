# VOW architecture

```
request → planner / Markovian (optional) → Warden gateway → tools → verifier → memory → RCF
                                        ↘ approvals ↗           ↘ traces
```

- `src/core/agent` — task state machine, orchestration, and bounded Markovian reasoning
- `src/core/warden` — policy, approvals, path guard, audit, gateway
- `src/core/execution` — tool registry, retries, builtin tools including `run_sql`
- `src/core/verification` — inspect actual outputs, including Zetaris row structure
- `src/core/memory` — dictionary, retrieval, conflicts, consolidation
- `src/core/traces` — append-only event log per task
- `src/core/rcf` — baseline vs VOW evaluation
- `src/integrations/meterless` — OpenAI-compatible client for NVIDIA Nemotron via Meterless Runtime
- `src/integrations/zetaris` — restricted read-only SQL client and query policy
- `src/app/api` — server routes that call core modules (secrets stay here)
- `src/core/agent/queue.ts` — durable file-backed queue: enqueue, exclusive claim, cancel, interrupted recovery
- `src/core/agent/worker.ts` — in-process background worker (`tickWorker`/`drainQueue`/`startWorker`); single-claim, bounded concurrency
- Away Mode lifecycle: `enqueue (202) → queued → claimed → planning/executing → awaiting_approval | verifying → completed/failed/blocked/cancelled`, with `interrupted → queued` on recovery. Every tool call still passes `tool-gateway.ts`; approvals are task-bound and single-use; cancellation is checked before each step and prevents retries.

Every tool call, including Zetaris `run_sql`, is authorized by `src/core/warden/tool-gateway.ts` before execution.
