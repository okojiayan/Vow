import { z } from "zod";

export const operatingModeSchema = z.enum(["supervised", "assisted", "autonomous"]);
export const taskStatusSchema = z.enum([
  "received",
  "queued",
  "claimed",
  "planning",
  "awaiting_approval",
  "executing",
  "verifying",
  "interrupted",
  "completed",
  "failed",
  "blocked",
  "cancelled",
]);

export const effortLevelSchema = z.enum(["Light", "Medium", "High", "Max", "PlusMax"]);

export const runTaskSchema = z.object({
  message: z.string().trim().min(1).max(8000),
  conversationId: z.string().optional(),
  effortLevel: effortLevelSchema.optional(),
});

export const continueTaskSchema = z.object({
  taskId: z.string().min(1),
});

export const approvalDecisionSchema = z.object({
  approvalId: z.string().min(1),
  decision: z.enum(["approve", "deny"]),
  note: z.string().max(2000).optional(),
});

export const memorySearchSchema = z.object({
  query: z.string().trim().min(1).max(2000),
  limit: z.number().int().min(1).max(50).optional(),
});

export const wardenModeSchema = z.object({
  mode: operatingModeSchema,
});

export const evalRunSchema = z.object({
  includeLiveModel: z.boolean().optional(),
});

export const enqueueTaskSchema = z.object({
  message: z.string().trim().min(1).max(8000),
  conversationId: z.string().optional(),
  autonomyMode: operatingModeSchema.optional(),
  effortLevel: effortLevelSchema.optional(),
});

export const cancelTaskSchema = z.object({
  reason: z.string().max(2000).optional(),
});
