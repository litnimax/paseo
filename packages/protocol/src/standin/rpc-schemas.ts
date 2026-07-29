import { z } from "zod";
import { AgentProviderSchema } from "../provider-manifest.js";

export const StandInStatusSchema = z.enum(["running", "completed", "stopped", "failed"]);

export const StandInLogEntrySchema = z.object({
  seq: z.number().int().positive(),
  timestamp: z.string(),
  exchange: z.number().int().positive().nullable(),
  source: z.enum(["stand-in", "agent", "reply"]),
  level: z.enum(["info", "error"]),
  text: z.string(),
});

export const StandInExchangeSchema = z.object({
  index: z.number().int().positive(),
  agentMessage: z.string(),
  decision: z.enum(["reply", "done"]),
  message: z.string(),
  startedAt: z.string(),
  completedAt: z.string(),
});

export const StandInRecordSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  agentId: z.string(),
  brief: z.string(),
  cwd: z.string(),
  provider: AgentProviderSchema,
  model: z.string().nullable(),
  modeId: z.string().nullable(),
  /** Resolved reply prefix. `null` means replies are sent verbatim. */
  label: z.string().nullable(),
  archive: z.boolean(),
  maxReplies: z.number().int().positive().nullable(),
  maxTimeMs: z.number().int().positive().nullable(),
  status: StandInStatusSchema,
  standInAgentId: z.string().nullable(),
  replyCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  stopRequestedAt: z.string().nullable(),
  exchanges: z.array(StandInExchangeSchema),
  logs: z.array(StandInLogEntrySchema),
  nextLogSeq: z.number().int().positive(),
});

export const StandInListItemSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  agentId: z.string(),
  status: StandInStatusSchema,
  cwd: z.string(),
  replyCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const StandInStartRequestSchema = z.object({
  type: z.literal("standin.start.request"),
  requestId: z.string(),
  agentId: z.string().trim().min(1),
  brief: z.string().trim().min(1),
  name: z.string().trim().min(1).optional(),
  provider: AgentProviderSchema.optional(),
  model: z.string().trim().min(1).optional(),
  modeId: z.string().trim().min(1).optional(),
  label: z.string().trim().min(1).optional(),
  /** Prefix each reply with the stand-in label so the chat stays readable. Default true. */
  labelReplies: z.boolean().optional(),
  archive: z.boolean().optional(),
  maxReplies: z.number().int().positive().optional(),
  maxTimeMs: z.number().int().positive().optional(),
});

export const StandInListRequestSchema = z.object({
  type: z.literal("standin.list.request"),
  requestId: z.string(),
});

export const StandInInspectRequestSchema = z.object({
  type: z.literal("standin.inspect.request"),
  requestId: z.string(),
  id: z.string().trim().min(1),
});

export const StandInLogsRequestSchema = z.object({
  type: z.literal("standin.get_logs.request"),
  requestId: z.string(),
  id: z.string().trim().min(1),
  afterSeq: z.number().int().nonnegative().optional(),
});

export const StandInStopRequestSchema = z.object({
  type: z.literal("standin.stop.request"),
  requestId: z.string(),
  id: z.string().trim().min(1),
});

export const StandInStartResponseSchema = z.object({
  type: z.literal("standin.start.response"),
  payload: z.object({
    requestId: z.string(),
    standIn: StandInRecordSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const StandInListResponseSchema = z.object({
  type: z.literal("standin.list.response"),
  payload: z.object({
    requestId: z.string(),
    standIns: z.array(StandInListItemSchema),
    error: z.string().nullable(),
  }),
});

export const StandInInspectResponseSchema = z.object({
  type: z.literal("standin.inspect.response"),
  payload: z.object({
    requestId: z.string(),
    standIn: StandInRecordSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const StandInLogsResponseSchema = z.object({
  type: z.literal("standin.get_logs.response"),
  payload: z.object({
    requestId: z.string(),
    standIn: StandInRecordSchema.nullable(),
    entries: z.array(StandInLogEntrySchema),
    nextCursor: z.number().int().nonnegative(),
    error: z.string().nullable(),
  }),
});

export const StandInStopResponseSchema = z.object({
  type: z.literal("standin.stop.response"),
  payload: z.object({
    requestId: z.string(),
    standIn: StandInRecordSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export type StandInStatus = z.infer<typeof StandInStatusSchema>;
export type StandInLogEntry = z.infer<typeof StandInLogEntrySchema>;
export type StandInExchange = z.infer<typeof StandInExchangeSchema>;
export type StandInRecord = z.infer<typeof StandInRecordSchema>;
export type StandInListItem = z.infer<typeof StandInListItemSchema>;
export type StandInStartRequest = z.infer<typeof StandInStartRequestSchema>;
export type StandInListRequest = z.infer<typeof StandInListRequestSchema>;
export type StandInInspectRequest = z.infer<typeof StandInInspectRequestSchema>;
export type StandInLogsRequest = z.infer<typeof StandInLogsRequestSchema>;
export type StandInStopRequest = z.infer<typeof StandInStopRequestSchema>;
export type StandInStartResponse = z.infer<typeof StandInStartResponseSchema>;
export type StandInListResponse = z.infer<typeof StandInListResponseSchema>;
export type StandInInspectResponse = z.infer<typeof StandInInspectResponseSchema>;
export type StandInLogsResponse = z.infer<typeof StandInLogsResponseSchema>;
export type StandInStopResponse = z.infer<typeof StandInStopResponseSchema>;
