export type StandInStatus = "running" | "completed" | "stopped" | "failed";

export interface StandInLogEntry {
  seq: number;
  timestamp: string;
  exchange: number | null;
  source: "stand-in" | "agent" | "reply";
  level: "info" | "error";
  text: string;
}

export interface StandInExchange {
  index: number;
  agentMessage: string;
  decision: "reply" | "done";
  message: string;
  startedAt: string;
  completedAt: string;
}

export interface StandInRecord {
  id: string;
  name: string | null;
  agentId: string;
  brief: string;
  cwd: string;
  provider: string;
  model: string | null;
  modeId: string | null;
  label: string | null;
  archive: boolean;
  maxReplies: number | null;
  maxTimeMs: number | null;
  status: StandInStatus;
  standInAgentId: string | null;
  replyCount: number;
  createdAt: string;
  updatedAt: string;
  startedAt: string;
  completedAt: string | null;
  stopRequestedAt: string | null;
  exchanges: StandInExchange[];
  logs: StandInLogEntry[];
  nextLogSeq: number;
}

export interface StandInListItem {
  id: string;
  name: string | null;
  agentId: string;
  status: StandInStatus;
  cwd: string;
  replyCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface StandInStartPayload {
  requestId: string;
  standIn: StandInRecord | null;
  error: string | null;
}

export interface StandInListPayload {
  requestId: string;
  standIns: StandInListItem[];
  error: string | null;
}

export interface StandInInspectPayload {
  requestId: string;
  standIn: StandInRecord | null;
  error: string | null;
}

export interface StandInLogsPayload {
  requestId: string;
  standIn: StandInRecord | null;
  entries: StandInLogEntry[];
  nextCursor: number;
  error: string | null;
}

export interface StandInStopPayload {
  requestId: string;
  standIn: StandInRecord | null;
  error: string | null;
}

export interface StandInStartInput {
  agentId: string;
  brief: string;
  name?: string;
  provider?: string;
  model?: string;
  modeId?: string;
  label?: string;
  labelReplies?: boolean;
  archive?: boolean;
  maxReplies?: number;
  maxTimeMs?: number;
}

export interface StandInDaemonClient {
  standInStart(input: StandInStartInput): Promise<StandInStartPayload>;
  standInList(): Promise<StandInListPayload>;
  standInInspect(id: string): Promise<StandInInspectPayload>;
  standInLogs(id: string, afterSeq?: number): Promise<StandInLogsPayload>;
  standInStop(id: string): Promise<StandInStopPayload>;
  close(): Promise<void>;
}
