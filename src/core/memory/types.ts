export type MemoryKind =
  | "observation"
  | "inference"
  | "decision"
  | "failure"
  | "preference"
  | "working"
  | "episodic"
  | "semantic"
  | "project"
  | "procedural-learning";

export type MemoryScopeType = "account" | "project" | "conversation" | "task";

export type MemoryStatus =
  | "candidate"
  | "active"
  | "disputed"
  | "superseded"
  | "expired"
  | "archived"
  | "deleted";

export type VerificationStatus = "unverified" | "verified" | "disputed";

export type EvidenceKind = "direct" | "tool-observed" | "external" | "inferred";

export interface MemorySource {
  type: "user" | "tool" | "model" | "system" | "eval";
  ref: string;
}

export interface MemoryVersion {
  version: number;
  content: string;
  updatedAt: string;
}

export interface MemoryEvidence {
  kind: EvidenceKind;
  sourceType: string;
  sourceRef: string;
  excerpt?: string;
  capturedAt: string;
  untrusted?: boolean;
}

export interface MemoryEntityLink {
  entryId: string;
  predicate?: string;
}

export interface MemoryRecord {
  id: string;
  content: string;
  kind: MemoryKind;
  entities: string[];
  keywords: string[];
  projectId?: string;
  conversationId?: string;
  source: MemorySource;
  provenance: string;
  relevance?: number;
  conflictStatus: "none" | "open" | "acknowledged";
  conflictWith?: string[];
  versions: MemoryVersion[];
  createdAt: string;
  updatedAt: string;
  /** Owner scope. Defaults to "local" for the single-user install. */
  accountId?: string;
  scope?: MemoryScopeType;
  scopeId?: string;
  status?: MemoryStatus;
  confidence?: number;
  verificationStatus?: VerificationStatus;
  validFrom?: string;
  validUntil?: string;
  importance?: number;
  sensitivity?: "normal" | "sensitive" | "blocked";
  idempotencyKey?: string;
  supersedes?: string[];
  supersededBy?: string;
  pinned?: boolean;
  evidence?: MemoryEvidence;
  entityLinks?: MemoryEntityLink[];
  lastAccessedAt?: string;
}

export type DictionaryEntryType =
  | "person"
  | "organisation"
  | "project"
  | "event"
  | "document"
  | "file"
  | "concept"
  | "product"
  | "task"
  | "place"
  | "preference"
  | string;

export interface DictionaryEntry {
  id: string;
  type: DictionaryEntryType;
  name: string;
  aliases: string[];
  description?: string;
  attributes?: Record<string, string>;
  status: "current" | "historical" | "disputed" | "unverified" | "archived";
  provenance: string;
  accountId: string;
  firstSeen: string;
  lastSeen: string;
  createdAt: string;
  updatedAt: string;
}

export interface DictionaryRelation {
  id: string;
  fromId: string;
  toId: string;
  type: string;
  provenance: string;
  accountId: string;
  createdAt: string;
}

export interface DictionaryStoreShape {
  entries: DictionaryEntry[];
  relations: DictionaryRelation[];
}
