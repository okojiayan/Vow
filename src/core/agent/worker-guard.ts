// Guards the public POST /api/worker/tick endpoint.
//
// Threat: without any control, any client that can reach the dev server can
// trigger worker execution (CPU + Meterless spend) with an unauthenticated POST.
// The in-process worker used by enqueue does NOT go through HTTP, so guarding
// the HTTP route never breaks legitimate background execution.
//
// Policy:
// - If VOW_WORKER_TOKEN is configured, POST requires
//   `Authorization: Bearer <token>`. Wrong/missing token -> 401.
// - Always: per-process sliding-window rate limit on POST (defaults 20/min).
//   Excess -> 429. GET (counts-only summary) stays public.

export interface TickAccess {
  authorized: boolean;
  status: 200 | 401 | 429;
  reason: string;
}

const hits: number[] = [];

export function resetTickRateLimit(): void {
  hits.length = 0;
}

function rateLimited(now: number, limit: number, windowMs: number): boolean {
  while (hits.length && hits[0] <= now - windowMs) hits.shift();
  if (hits.length >= limit) return true;
  hits.push(now);
  return false;
}

export function checkTickAccess(input: {
  authorizationHeader: string | null;
  workerToken: string;
  rateLimitPerMinute: number;
  now?: number;
}): TickAccess {
  const now = input.now ?? Date.now();
  const token = input.workerToken.trim();
  if (token) {
    const presented = (input.authorizationHeader ?? "").trim();
    if (presented !== `Bearer ${token}`) {
      return { authorized: false, status: 401, reason: "Missing or incorrect worker token." };
    }
    return { authorized: true, status: 200, reason: "Authorized worker-tick caller." };
  }
  if (rateLimited(now, input.rateLimitPerMinute, 60_000)) {
    return { authorized: false, status: 429, reason: "Worker-tick rate limit exceeded. Retry shortly." };
  }
  return { authorized: true, status: 200, reason: "Local worker-tick call." };
}
