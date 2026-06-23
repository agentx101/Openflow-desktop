import cors from "cors";
import express from "express";
import { WebSocketServer } from "ws";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import Database from "better-sqlite3";
import { runPersonaNeedEmotion, runPneFramework, runRedditScraper } from "./agentBridge";
import { DATA_STORE_BLUEPRINT_IDS, getBlueprintById, NODE_BLUEPRINTS } from "./blueprints";

type CanvasNodeKind =
  | "agent"
  | "source"
  | "brief"
  | "brain_hub"
  | "brain_agent"
  | "source_connector"
  | "data_store"
  | "generation.image"
  | "generation.video"
  | "generation.audio"
  | "generation.music"
  | "generation.template"
  | "publishing"
  | "performance"
  | "synth";
type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
type GenerationJobStatus = "queued" | "running" | "completed" | "failed";

type GenerationNodeConfig = {
  blueprintId?: string;
  workflowRef: string;
  templateId?: string;
  inputs?: Record<string, unknown>;
  params?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
};

type WorkspaceProviderConnection = {
  workspaceId: string;
  provider: string;
  state: "disconnected" | "connected" | "expired" | "scope_missing";
  authType: "oauth" | "api_key";
  account?: string;
  encryptedToken?: string;
  scopes: string[];
  updatedAt: string;
};

type CanvasNode = {
  id: string;
  kind: CanvasNodeKind;
  x: number;
  y: number;
  title: string;
  subtitle?: string;
  config?: GenerationNodeConfig;
};
type CanvasEdge = { id: string; from: string; to: string };
type CanvasDocument = { productId: string; nodes: CanvasNode[]; edges: CanvasEdge[]; updatedAt: string };
type Product = { id: string; folderId: string; name: string };
type ProjectFolder = { id: string; workspaceId: string; name: string };
type WorkspaceSnapshot = {
  workspaceId: string;
  folders: ProjectFolder[];
  products: Product[];
  documents: Record<string, CanvasDocument>;
};

type GenerationArtifact = {
  id: string;
  runId: string;
  stepId: string;
  type: "image" | "video" | "audio";
  uri: string;
  previewUri: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type GenerationRun = {
  id: string;
  workspaceId: string;
  productId: string;
  status: RunStatus;
  startedAt: string;
  completedAt?: string | null;
  errorMessage?: string | null;
};

type GenerationRunStep = {
  id: string;
  runId: string;
  nodeId: string;
  nodeKind: CanvasNodeKind;
  status: RunStatus;
  startedAt?: string | null;
  completedAt?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  providerJobId?: string | null;
  durationMs?: number | null;
};

type GenerationRunDetail = {
  run: GenerationRun;
  steps: GenerationRunStep[];
  artifacts: GenerationArtifact[];
};

type GenerationJobRequest = {
  workflowRef: string;
  inputs: Record<string, unknown>;
  params: Record<string, unknown>;
  metadata: Record<string, unknown>;
  idempotencyKey: string;
};

type GenerationJobResult = {
  providerJobId: string;
};

type GenerationJobStatusPayload = {
  providerJobId: string;
  status: GenerationJobStatus;
  progress: number;
  errorCode?: "provider_error" | "workflow_error" | "asset_fetch_error" | "timeout";
  errorMessage?: string;
  startedAt?: string;
  completedAt?: string;
};

type EntitlementMode = "community" | "pro" | "byok";

type DesktopSettings = {
  entitlement: {
    mode: EntitlementMode;
    openflowToken: string;
  };
  keys: {
    openaiApiKey: string;
    anthropicApiKey: string;
    customAgentApiKey: string;
    elevenlabsApiKey: string;
    comfyApiBase: string;
    comfyApiKey: string;
  };
  integrations: Record<string, {
    connected?: boolean;
    provider?: string;
    authType?: string;
    account?: string;
    keyPreview?: string;
    connectedAt?: string;
  }>;
  billing: {
    cycle: "monthly" | "yearly";
    plan: "standard" | "creator" | "pro";
    creditsRemaining: number;
    creditsTotal: number;
  };
  runtime: {
    backendMode: "local" | "hosted";
    hostedApiBase: string;
    hostedWorkspaceId: string;
    hostedAuthToken: string;
  };
};

type WorkspaceEvent =
  | { type: "canvas.updated"; workspaceId: string; productId: string; doc: CanvasDocument; updatedAt: string }
  | { type: "product.created"; workspaceId: string; folderId: string; product: Product; updatedAt: string }
  | { type: "run.started"; workspaceId: string; productId: string; run: GenerationRun; updatedAt: string }
  | {
      type: "run.step.updated";
      workspaceId: string;
      productId: string;
      runId: string;
      step: GenerationRunStep;
      updatedAt: string;
    }
  | {
      type: "run.artifact.created";
      workspaceId: string;
      productId: string;
      runId: string;
      artifact: GenerationArtifact;
      updatedAt: string;
    }
  | { type: "run.completed"; workspaceId: string; productId: string; run: GenerationRun; updatedAt: string }
  | { type: "run.failed"; workspaceId: string; productId: string; run: GenerationRun; updatedAt: string }
  | {
      type: "generation.job.submitted";
      workspaceId: string;
      productId: string;
      runId: string;
      nodeId: string;
      job: GenerationJobResult;
      updatedAt: string;
    }
  | {
      type: "generation.job.updated";
      workspaceId: string;
      productId: string;
      runId: string;
      nodeId: string;
      job: GenerationJobStatusPayload;
      updatedAt: string;
    }
  | {
      type: "generation.artifact.created";
      workspaceId: string;
      productId: string;
      runId: string;
      nodeId: string;
      artifact: GenerationArtifact;
      updatedAt: string;
    }
  | {
      type: "generation.job.failed";
      workspaceId: string;
      productId: string;
      runId: string;
      nodeId: string;
      job: GenerationJobStatusPayload;
      updatedAt: string;
    };

type JobState = {
  id: string;
  request: GenerationJobRequest;
  createdAt: number;
  durationMs: number;
  fail: boolean;
};

type ComfyTemplate = {
  id: string;
  sourceRepo: string;
  sourcePath: string;
  name: string;
  category: string;
  subcategory: string;
  workflowRef: string;
  workflowJson: string;
  previewUrl: string;
  tags: string[];
  updatedAt: string;
};

const mockJobs = new Map<string, JobState>();
const elevenJobs = new Map<string, JobState>();
const runCancellationMap = new Map<string, { cancelled: boolean }>();
const ELEVEN_API_BASE = process.env.ELEVENLABS_API_BASE || "https://api.elevenlabs.io/v1";
const ELEVEN_API_KEY = process.env.ELEVENLABS_API_KEY;
const BILLING_VERIFY_URL = process.env.OPENFLOW_BILLING_VERIFY_URL || "";
const BILLING_VERIFY_SECRET = process.env.OPENFLOW_BILLING_VERIFY_SECRET || "";
const billingTokenCache = new Map<string, { ok: boolean; expiresAt: number }>();
const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  entitlement: {
    mode: "community",
    openflowToken: ""
  },
  keys: {
    openaiApiKey: "",
    anthropicApiKey: "",
    customAgentApiKey: "",
    elevenlabsApiKey: "",
    comfyApiBase: "",
    comfyApiKey: ""
  },
  integrations: {},
  billing: {
    cycle: "yearly",
    plan: "standard",
    creditsRemaining: 50400,
    creditsTotal: 50400
  },
  runtime: {
    backendMode: "local",
    hostedApiBase: "",
    hostedWorkspaceId: "",
    hostedAuthToken: ""
  }
};

const PORT = Number(process.env.OPENFLOW_LOCAL_PORT || 8790);
const DB_PATH = process.env.OPENFLOW_LOCAL_DB_PATH || resolve(process.cwd(), "data", "openflow-local.db");
const WORKSPACE_DEFAULT = process.env.OPENFLOW_WORKSPACE_ID || "default-workspace";
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS project_folders (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  folder_id TEXT NOT NULL,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS canvas_docs (
  product_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  doc_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS generation_runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  error_message TEXT
);
CREATE TABLE IF NOT EXISTS generation_run_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  node_kind TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  error_code TEXT,
  error_message TEXT,
  provider_job_id TEXT,
  duration_ms INTEGER
);
CREATE TABLE IF NOT EXISTS generation_artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  type TEXT NOT NULL,
  uri TEXT NOT NULL,
  preview_uri TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS comfy_templates (
  id TEXT PRIMARY KEY,
  source_repo TEXT NOT NULL,
  source_path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  subcategory TEXT NOT NULL,
  workflow_ref TEXT NOT NULL,
  workflow_json TEXT NOT NULL,
  preview_url TEXT,
  tags_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS node_blueprints (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  connection_json TEXT,
  inputs_json TEXT,
  outputs_json TEXT,
  execution_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workspace_provider_connections (
  workspace_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  state TEXT NOT NULL,
  auth_type TEXT NOT NULL,
  account TEXT,
  encrypted_token TEXT,
  scopes_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id, provider)
);`);

for (const tableName of DATA_STORE_BLUEPRINT_IDS) {
  db.exec(`
CREATE TABLE IF NOT EXISTS ${tableName} (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  source_node_id TEXT,
  run_id TEXT,
  payload_json TEXT NOT NULL,
  ingested_at TEXT NOT NULL
);`);
}

const countFolders = db.prepare("SELECT COUNT(1) as count FROM project_folders WHERE workspace_id = ?");
const insertFolder = db.prepare("INSERT INTO project_folders (id, workspace_id, name) VALUES (?, ?, ?)");
const insertProduct = db.prepare("INSERT INTO products (id, workspace_id, folder_id, name) VALUES (?, ?, ?, ?)");
const upsertDoc = db.prepare(`
  INSERT INTO canvas_docs (product_id, workspace_id, doc_json, updated_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(product_id) DO UPDATE SET
    doc_json = excluded.doc_json,
    updated_at = excluded.updated_at,
    workspace_id = excluded.workspace_id`);
const readFolders = db.prepare(
  "SELECT id, workspace_id as workspaceId, name FROM project_folders WHERE workspace_id = ? ORDER BY rowid ASC"
);
const readProducts = db.prepare(
  "SELECT id, folder_id as folderId, name FROM products WHERE workspace_id = ? ORDER BY rowid ASC"
);
const readDocs = db.prepare(
  "SELECT product_id as productId, doc_json as docJson FROM canvas_docs WHERE workspace_id = ? ORDER BY rowid ASC"
);

const insertRunStmt = db.prepare(`
  INSERT INTO generation_runs (id, workspace_id, product_id, status, started_at, completed_at, error_message)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const updateRunStmt = db.prepare(`
  UPDATE generation_runs
  SET status = ?, completed_at = ?, error_message = ?
  WHERE id = ?
`);
const readRunsStmt = db.prepare(`
  SELECT
    id,
    workspace_id as workspaceId,
    product_id as productId,
    status,
    started_at as startedAt,
    completed_at as completedAt,
    error_message as errorMessage
  FROM generation_runs
  WHERE workspace_id = ? AND product_id = ?
  ORDER BY started_at DESC
`);
const readRunStmt = db.prepare(`
  SELECT
    id,
    workspace_id as workspaceId,
    product_id as productId,
    status,
    started_at as startedAt,
    completed_at as completedAt,
    error_message as errorMessage
  FROM generation_runs
  WHERE id = ?
  LIMIT 1
`);
const insertStepStmt = db.prepare(`
  INSERT INTO generation_run_steps (
    id, run_id, node_id, node_kind, status, started_at, completed_at, error_code, error_message, provider_job_id, duration_ms
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const updateStepStmt = db.prepare(`
  UPDATE generation_run_steps
  SET status = ?,
      started_at = ?,
      completed_at = ?,
      error_code = ?,
      error_message = ?,
      provider_job_id = ?,
      duration_ms = ?
  WHERE id = ?
`);
const readStepsStmt = db.prepare(`
  SELECT
    id,
    run_id as runId,
    node_id as nodeId,
    node_kind as nodeKind,
    status,
    started_at as startedAt,
    completed_at as completedAt,
    error_code as errorCode,
    error_message as errorMessage,
    provider_job_id as providerJobId,
    duration_ms as durationMs
  FROM generation_run_steps
  WHERE run_id = ?
  ORDER BY rowid ASC
`);
const insertArtifactStmt = db.prepare(`
  INSERT INTO generation_artifacts (
    id, run_id, step_id, type, uri, preview_uri, metadata_json, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const readArtifactsStmt = db.prepare(`
  SELECT
    id,
    run_id as runId,
    step_id as stepId,
    type,
    uri,
    preview_uri as previewUri,
    metadata_json as metadataJson,
    created_at as createdAt
  FROM generation_artifacts
  WHERE run_id = ?
  ORDER BY rowid ASC
`);
const readAppSettingStmt = db.prepare("SELECT value_json as valueJson FROM app_settings WHERE key = ? LIMIT 1");
const upsertAppSettingStmt = db.prepare(`
  INSERT INTO app_settings (key, value_json, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET
    value_json = excluded.value_json,
    updated_at = excluded.updated_at
`);
const upsertComfyTemplateStmt = db.prepare(`
  INSERT INTO comfy_templates (
    id, source_repo, source_path, name, category, subcategory, workflow_ref, workflow_json, preview_url, tags_json, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(source_path) DO UPDATE SET
    source_repo = excluded.source_repo,
    name = excluded.name,
    category = excluded.category,
    subcategory = excluded.subcategory,
    workflow_ref = excluded.workflow_ref,
    workflow_json = excluded.workflow_json,
    preview_url = excluded.preview_url,
    tags_json = excluded.tags_json,
    updated_at = excluded.updated_at
`);
const readComfyTemplatesStmt = db.prepare(`
  SELECT
    id,
    source_repo as sourceRepo,
    source_path as sourcePath,
    name,
    category,
    subcategory,
    workflow_ref as workflowRef,
    workflow_json as workflowJson,
    preview_url as previewUrl,
    tags_json as tagsJson,
    updated_at as updatedAt
  FROM comfy_templates
  ORDER BY category ASC, subcategory ASC, name ASC
`);
const upsertNodeBlueprintStmt = db.prepare(`
  INSERT INTO node_blueprints (
    id, category, kind, name, description, connection_json, inputs_json, outputs_json, execution_json, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    category = excluded.category,
    kind = excluded.kind,
    name = excluded.name,
    description = excluded.description,
    connection_json = excluded.connection_json,
    inputs_json = excluded.inputs_json,
    outputs_json = excluded.outputs_json,
    execution_json = excluded.execution_json,
    updated_at = excluded.updated_at
`);
const readNodeBlueprintsStmt = db.prepare(`
  SELECT
    id, category, kind, name, description,
    connection_json as connectionJson,
    inputs_json as inputsJson,
    outputs_json as outputsJson,
    execution_json as executionJson
  FROM node_blueprints
  ORDER BY category ASC, name ASC
`);
const upsertWorkspaceProviderConnectionStmt = db.prepare(`
  INSERT INTO workspace_provider_connections (
    workspace_id, provider, state, auth_type, account, encrypted_token, scopes_json, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(workspace_id, provider) DO UPDATE SET
    state = excluded.state,
    auth_type = excluded.auth_type,
    account = excluded.account,
    encrypted_token = excluded.encrypted_token,
    scopes_json = excluded.scopes_json,
    updated_at = excluded.updated_at
`);
const readWorkspaceProviderConnectionStmt = db.prepare(`
  SELECT
    workspace_id as workspaceId,
    provider,
    state,
    auth_type as authType,
    account,
    encrypted_token as encryptedToken,
    scopes_json as scopesJson,
    updated_at as updatedAt
  FROM workspace_provider_connections
  WHERE workspace_id = ? AND provider = ?
  LIMIT 1
`);
const readWorkspaceProviderConnectionsStmt = db.prepare(`
  SELECT
    workspace_id as workspaceId,
    provider,
    state,
    auth_type as authType,
    account,
    encrypted_token as encryptedToken,
    scopes_json as scopesJson,
    updated_at as updatedAt
  FROM workspace_provider_connections
  WHERE workspace_id = ?
  ORDER BY provider ASC
`);
const dataStoreInsertStmtCache = new Map<string, Database.Statement>();
const dataStoreReadRecentStmtCache = new Map<string, Database.Statement>();

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function encryptToken(raw?: string) {
  if (!raw) return "";
  return Buffer.from(raw, "utf8").toString("base64");
}
function decryptToken(raw?: string) {
  if (!raw) return "";
  try {
    return Buffer.from(raw, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function seedNodeBlueprints() {
  const tx = db.transaction(() => {
    for (const bp of NODE_BLUEPRINTS) {
      upsertNodeBlueprintStmt.run(
        bp.id,
        bp.category,
        bp.kind,
        bp.name,
        bp.description,
        bp.connection ? JSON.stringify(bp.connection) : null,
        bp.inputs ? JSON.stringify(bp.inputs) : null,
        bp.outputs ? JSON.stringify(bp.outputs) : null,
        JSON.stringify(bp.execution),
        nowIso()
      );
    }
  });
  tx();
}
seedNodeBlueprints();

function listNodeBlueprints() {
  const rows = readNodeBlueprintsStmt.all() as Array<{
    id: string;
    category: string;
    kind: string;
    name: string;
    description: string;
    connectionJson: string | null;
    inputsJson: string | null;
    outputsJson: string | null;
    executionJson: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    category: row.category,
    kind: row.kind,
    name: row.name,
    description: row.description,
    connection: row.connectionJson ? JSON.parse(row.connectionJson) : undefined,
    inputs: row.inputsJson ? JSON.parse(row.inputsJson) : undefined,
    outputs: row.outputsJson ? JSON.parse(row.outputsJson) : undefined,
    execution: JSON.parse(row.executionJson)
  }));
}

function getWorkspaceProviderConnection(workspaceId: string, provider: string): WorkspaceProviderConnection | null {
  const row = readWorkspaceProviderConnectionStmt.get(workspaceId, provider) as
    | {
        workspaceId: string;
        provider: string;
        state: WorkspaceProviderConnection["state"];
        authType: WorkspaceProviderConnection["authType"];
        account: string | null;
        encryptedToken: string | null;
        scopesJson: string;
        updatedAt: string;
      }
    | undefined;
  if (!row) return null;
  return {
    workspaceId: row.workspaceId,
    provider: row.provider,
    state: row.state,
    authType: row.authType,
    account: row.account || undefined,
    encryptedToken: row.encryptedToken || undefined,
    scopes: (() => {
      try {
        const parsed = JSON.parse(row.scopesJson);
        return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
      } catch {
        return [];
      }
    })(),
    updatedAt: row.updatedAt
  };
}

function getWorkspaceProviderToken(workspaceId: string, provider: string): string {
  const conn = getWorkspaceProviderConnection(workspaceId, provider);
  return decryptToken(conn?.encryptedToken);
}

function dataStoreInsertStmt(tableName: string) {
  if (!DATA_STORE_BLUEPRINT_IDS.has(tableName)) {
    throw new Error(`Unknown data store table: ${tableName}`);
  }
  if (!dataStoreInsertStmtCache.has(tableName)) {
    dataStoreInsertStmtCache.set(
      tableName,
      db.prepare(
        `INSERT INTO ${tableName} (id, workspace_id, source_node_id, run_id, payload_json, ingested_at) VALUES (?, ?, ?, ?, ?, ?)`
      )
    );
  }
  return dataStoreInsertStmtCache.get(tableName)!;
}

function dataStoreReadRecentStmt(tableName: string) {
  if (!DATA_STORE_BLUEPRINT_IDS.has(tableName)) {
    throw new Error(`Unknown data store table: ${tableName}`);
  }
  if (!dataStoreReadRecentStmtCache.has(tableName)) {
    dataStoreReadRecentStmtCache.set(
      tableName,
      db.prepare(
        `SELECT id, workspace_id as workspaceId, source_node_id as sourceNodeId, run_id as runId, payload_json as payloadJson, ingested_at as ingestedAt FROM ${tableName} WHERE workspace_id = ? ORDER BY ingested_at DESC LIMIT ?`
      )
    );
  }
  return dataStoreReadRecentStmtCache.get(tableName)!;
}

function addDataStoreRecord(
  tableName: string,
  workspaceId: string,
  sourceNodeId: string | undefined,
  runId: string | undefined,
  payload: Record<string, unknown>
) {
  const row = {
    id: newId("ds"),
    workspaceId,
    sourceNodeId: sourceNodeId || null,
    runId: runId || null,
    payloadJson: JSON.stringify(payload || {}),
    ingestedAt: nowIso()
  };
  dataStoreInsertStmt(tableName).run(
    row.id,
    row.workspaceId,
    row.sourceNodeId,
    row.runId,
    row.payloadJson,
    row.ingestedAt
  );
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    sourceNodeId: row.sourceNodeId || undefined,
    runId: row.runId || undefined,
    payload,
    ingestedAt: row.ingestedAt
  };
}

function listRecentDataStoreRecords(tableName: string, workspaceId: string, limit = 50) {
  const rows = dataStoreReadRecentStmt(tableName).all(workspaceId, Math.max(1, Math.min(500, Math.floor(limit)))) as Array<{
    id: string;
    workspaceId: string;
    sourceNodeId: string | null;
    runId: string | null;
    payloadJson: string;
    ingestedAt: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspaceId,
    sourceNodeId: row.sourceNodeId || undefined,
    runId: row.runId || undefined,
    payload: (() => {
      try {
        return JSON.parse(row.payloadJson);
      } catch {
        return {};
      }
    })(),
    ingestedAt: row.ingestedAt
  }));
}

function listWorkspaceProviderConnections(workspaceId: string): WorkspaceProviderConnection[] {
  const rows = readWorkspaceProviderConnectionsStmt.all(workspaceId) as Array<{
    workspaceId: string;
    provider: string;
    state: WorkspaceProviderConnection["state"];
    authType: WorkspaceProviderConnection["authType"];
    account: string | null;
    encryptedToken: string | null;
    scopesJson: string;
    updatedAt: string;
  }>;
  return rows.map((row) => ({
    workspaceId: row.workspaceId,
    provider: row.provider,
    state: row.state,
    authType: row.authType,
    account: row.account || undefined,
    encryptedToken: row.encryptedToken || undefined,
    scopes: (() => {
      try {
        const parsed = JSON.parse(row.scopesJson);
        return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
      } catch {
        return [];
      }
    })(),
    updatedAt: row.updatedAt
  }));
}

function upsertWorkspaceProviderConnection(
  workspaceId: string,
  provider: string,
  input: {
    state: WorkspaceProviderConnection["state"];
    authType: WorkspaceProviderConnection["authType"];
    account?: string;
    token?: string;
    scopes?: string[];
  }
): WorkspaceProviderConnection {
  const normalized: WorkspaceProviderConnection = {
    workspaceId,
    provider,
    state: input.state,
    authType: input.authType,
    account: input.account || undefined,
    encryptedToken: encryptToken(input.token),
    scopes: (input.scopes || []).map((s) => String(s)),
    updatedAt: nowIso()
  };
  upsertWorkspaceProviderConnectionStmt.run(
    normalized.workspaceId,
    normalized.provider,
    normalized.state,
    normalized.authType,
    normalized.account || null,
    normalized.encryptedToken || null,
    JSON.stringify(normalized.scopes),
    normalized.updatedAt
  );
  return normalized;
}

function normalizeSettings(raw: unknown): DesktopSettings {
  const candidate = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const entitlement = (candidate.entitlement && typeof candidate.entitlement === "object"
    ? candidate.entitlement
    : {}) as Record<string, unknown>;
  const keys = (candidate.keys && typeof candidate.keys === "object" ? candidate.keys : {}) as Record<string, unknown>;
  const integrations =
    candidate.integrations && typeof candidate.integrations === "object"
      ? (candidate.integrations as Record<string, unknown>)
      : {};
  const modeRaw = String(entitlement.mode || DEFAULT_DESKTOP_SETTINGS.entitlement.mode);
  const mode: EntitlementMode = modeRaw === "pro" || modeRaw === "byok" ? modeRaw : "community";
  const billing = (candidate.billing && typeof candidate.billing === "object" ? candidate.billing : {}) as Record<string, unknown>;
  const runtime = (candidate.runtime && typeof candidate.runtime === "object" ? candidate.runtime : {}) as Record<string, unknown>;
  const cycleRaw = String(billing.cycle || DEFAULT_DESKTOP_SETTINGS.billing.cycle);
  const cycle: "monthly" | "yearly" = cycleRaw === "monthly" ? "monthly" : "yearly";
  const planRaw = String(billing.plan || DEFAULT_DESKTOP_SETTINGS.billing.plan);
  const plan: "standard" | "creator" | "pro" =
    planRaw === "creator" || planRaw === "pro" ? planRaw : "standard";
  const creditsTotal = Number(billing.creditsTotal ?? DEFAULT_DESKTOP_SETTINGS.billing.creditsTotal);
  const creditsRemaining = Number(billing.creditsRemaining ?? creditsTotal);
  return {
    entitlement: {
      mode,
      openflowToken: String(entitlement.openflowToken || "")
    },
    keys: {
      openaiApiKey: String(keys.openaiApiKey || ""),
      anthropicApiKey: String(keys.anthropicApiKey || ""),
      customAgentApiKey: String(keys.customAgentApiKey || ""),
      elevenlabsApiKey: String(keys.elevenlabsApiKey || ""),
      comfyApiBase: String(keys.comfyApiBase || ""),
      comfyApiKey: String(keys.comfyApiKey || "")
    },
    integrations: integrations as DesktopSettings["integrations"],
    billing: {
      cycle,
      plan,
      creditsTotal: Number.isFinite(creditsTotal) ? Math.max(0, Math.floor(creditsTotal)) : DEFAULT_DESKTOP_SETTINGS.billing.creditsTotal,
      creditsRemaining: Number.isFinite(creditsRemaining)
        ? Math.max(0, Math.floor(creditsRemaining))
        : DEFAULT_DESKTOP_SETTINGS.billing.creditsRemaining
    },
    runtime: {
      backendMode: String(runtime.backendMode || DEFAULT_DESKTOP_SETTINGS.runtime.backendMode) === "hosted" ? "hosted" : "local",
      hostedApiBase: String(runtime.hostedApiBase || ""),
      hostedWorkspaceId: String(runtime.hostedWorkspaceId || ""),
      hostedAuthToken: String(runtime.hostedAuthToken || "")
    }
  };
}

function getDesktopSettings(): DesktopSettings {
  const row = readAppSettingStmt.get("desktop_settings") as { valueJson: string } | undefined;
  if (!row) return { ...DEFAULT_DESKTOP_SETTINGS };
  try {
    return normalizeSettings(JSON.parse(row.valueJson));
  } catch {
    return { ...DEFAULT_DESKTOP_SETTINGS };
  }
}

function saveDesktopSettings(next: DesktopSettings): DesktopSettings {
  const normalized = normalizeSettings(next);
  upsertAppSettingStmt.run("desktop_settings", JSON.stringify(normalized), nowIso());
  return normalized;
}

function patchDesktopSettings(patch: Partial<DesktopSettings>): DesktopSettings {
  const current = getDesktopSettings();
  const merged: DesktopSettings = normalizeSettings({
    entitlement: { ...current.entitlement, ...(patch.entitlement || {}) },
    keys: { ...current.keys, ...(patch.keys || {}) },
    integrations: { ...current.integrations, ...((patch as any).integrations || {}) },
    billing: { ...current.billing, ...((patch as any).billing || {}) },
    runtime: { ...current.runtime, ...((patch as any).runtime || {}) }
  });
  return saveDesktopSettings(merged);
}

function scanJsonFiles(root: string): string[] {
  const out: string[] = [];
  if (!existsSync(root)) return out;
  const walk = (dir: string) => {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const full = `${dir}/${entry}`;
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (stat.isFile() && entry.toLowerCase().endsWith(".json")) {
        out.push(full);
      }
    }
  };
  walk(root);
  return out;
}

function prettifyName(raw: string): string {
  return raw
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function buildRawGitUrl(sourceRepo: string, relativePath: string): string {
  const repo = sourceRepo
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/^\/+/, "");
  return `https://raw.githubusercontent.com/${repo}/main/${relativePath.replace(/\\/g, "/")}`;
}

function importComfyTemplatesFromRepo(
  repoPath = process.env.COMFY_TEMPLATE_REPO_PATH || resolve(process.cwd(), "local-backend", "comfy-template-pack"),
  sourceRepo = process.env.COMFY_TEMPLATE_SOURCE_REPO || "https://github.com/mcphub-com/awesome-comfyui-templates.git"
) {
  let resolvedRepoPath = repoPath;
  let templatesRoot = resolve(resolvedRepoPath, "templates");
  if (!existsSync(templatesRoot)) {
    const fallbackRepo = "/private/tmp/awesome-comfyui-templates";
    const fallbackRoot = resolve(fallbackRepo, "templates");
    if (existsSync(fallbackRoot)) {
      resolvedRepoPath = fallbackRepo;
      templatesRoot = fallbackRoot;
    }
  }
  if (!existsSync(templatesRoot)) {
    return { imported: 0, skipped: 0, repoPath: resolvedRepoPath, templatesRoot, error: "templates root not found" };
  }
  const jsonFiles = scanJsonFiles(templatesRoot);
  let imported = 0;
  let skipped = 0;
  for (const filePath of jsonFiles) {
    try {
      const relPath = filePath.slice(resolvedRepoPath.length + 1).replace(/\\/g, "/");
      const afterTemplates = relPath.replace(/^templates\//, "");
      const parts = afterTemplates.split("/");
      const category = parts[0] || "uncategorized";
      const subcategory = parts.length > 2 ? parts[1] : "general";
      const baseName = filePath.split("/").pop()!.replace(/\.json$/i, "");
      const name = prettifyName(baseName);
      const workflowJsonRaw = readFileSync(filePath, "utf-8");
      JSON.parse(workflowJsonRaw);
      const dir = filePath.split("/").slice(0, -1).join("/");
      const previewCandidates = readdirSync(dir).filter((entry) =>
        /\.(webp|png|jpg|jpeg)$/i.test(entry)
      );
      const firstPreview = previewCandidates.sort()[0];
      const previewUrl = firstPreview
        ? buildRawGitUrl(sourceRepo, `${relPath.split("/").slice(0, -1).join("/")}/${firstPreview}`)
        : "";
      const workflowRef = `comfy_tpl_${baseName.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
      const tags = Array.from(new Set([category, subcategory, "comfyui", "community"]));
      const rowId = `tpl-${relPath.replace(/[^a-zA-Z0-9]+/g, "_")}`;
      upsertComfyTemplateStmt.run(
        rowId,
        sourceRepo,
        relPath,
        name,
        category,
        subcategory,
        workflowRef,
        workflowJsonRaw,
        previewUrl,
        JSON.stringify(tags),
        nowIso()
      );
      imported += 1;
    } catch {
      skipped += 1;
    }
  }
  return { imported, skipped, repoPath: resolvedRepoPath, templatesRoot };
}

function listComfyTemplates(): ComfyTemplate[] {
  const rows = readComfyTemplatesStmt.all() as Array<
    Omit<ComfyTemplate, "tags"> & { tagsJson: string }
  >;
  return rows.map((row) => ({
    id: row.id,
    sourceRepo: row.sourceRepo,
    sourcePath: row.sourcePath,
    name: row.name,
    category: row.category,
    subcategory: row.subcategory,
    workflowRef: row.workflowRef,
    workflowJson: row.workflowJson,
    previewUrl: row.previewUrl,
    tags: (() => {
      try {
        const parsed = JSON.parse((row as any).tagsJson);
        return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
      } catch {
        return [];
      }
    })(),
    updatedAt: row.updatedAt
  }));
}

function resolveHostedApiBase(settings: DesktopSettings): string | null {
  if (settings.runtime.backendMode !== "hosted") return null;
  const base = String(settings.runtime.hostedApiBase || "").trim().replace(/\/+$/, "");
  if (!base) return null;
  if (!/^https?:\/\//i.test(base)) return null;
  return base;
}

async function proxyHostedRequest(req: express.Request, res: express.Response, base: string) {
  const settings = getDesktopSettings();
  const upstreamUrl = `${base}${req.originalUrl}`;
  const headers: Record<string, string> = {};
  const inboundContentType = req.headers["content-type"];
  if (typeof inboundContentType === "string") headers["content-type"] = inboundContentType;
  if (settings.runtime.hostedAuthToken.trim()) {
    headers.Authorization = `Bearer ${settings.runtime.hostedAuthToken.trim()}`;
  }
  const method = req.method.toUpperCase();
  const hasBody = !["GET", "HEAD"].includes(method);
  const upstream = await fetch(upstreamUrl, {
    method,
    headers,
    body: hasBody ? JSON.stringify(req.body || {}) : undefined
  });

  res.status(upstream.status);
  const contentType = upstream.headers.get("content-type");
  if (contentType) res.setHeader("content-type", contentType);
  const text = await upstream.text();
  res.send(text);
}

function hasAgentByok(settings: DesktopSettings): boolean {
  return Boolean(
    settings.keys.openaiApiKey.trim() ||
      settings.keys.anthropicApiKey.trim() ||
      settings.keys.customAgentApiKey.trim()
  );
}

async function verifyProToken(token: string): Promise<boolean> {
  const normalized = token.trim();
  if (!normalized) return false;
  const now = Date.now();
  const cached = billingTokenCache.get(normalized);
  if (cached && cached.expiresAt > now) return cached.ok;

  let ok = false;
  if (BILLING_VERIFY_URL) {
    try {
      const res = await fetch(BILLING_VERIFY_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(BILLING_VERIFY_SECRET ? { Authorization: `Bearer ${BILLING_VERIFY_SECRET}` } : {})
        },
        body: JSON.stringify({
          token: normalized,
          product: "openflow",
          timestamp: new Date().toISOString()
        })
      });
      if (res.ok) {
        const body = (await res.json()) as { valid?: boolean; active?: boolean; ok?: boolean };
        ok = Boolean(body.valid ?? body.active ?? body.ok);
      }
    } catch {
      ok = false;
    }
  } else {
    ok = /^opf_(live|pro)_/i.test(normalized);
  }

  billingTokenCache.set(normalized, { ok, expiresAt: now + (ok ? 10 * 60_000 : 60_000) });
  return ok;
}

async function canUseAgenticFeatures(settings: DesktopSettings): Promise<boolean> {
  if (hasAgentByok(settings)) return true;
  if (settings.entitlement.mode !== "pro") return false;
  return verifyProToken(settings.entitlement.openflowToken);
}

function resolveElevenApiKey(settings: DesktopSettings): string | undefined {
  return settings.keys.elevenlabsApiKey.trim() || ELEVEN_API_KEY;
}

function isAgenticNode(node: CanvasNode): boolean {
  const workflowRef = String(node.config?.workflowRef || "");
  return node.kind === "generation.template" || workflowRef.startsWith("openflow_agent_");
}

function seedDocument(productId: string): CanvasDocument {
  return {
    productId,
    updatedAt: nowIso(),
    nodes: [
      { id: "n-source", kind: "source", x: 90, y: 120, title: "Data Source", subtitle: "Brief + hooks input" },
      {
        id: "n-template",
        kind: "generation.template",
        x: 350,
        y: 120,
        title: "Generation Template",
        subtitle: "UGC Launch Template",
        config: {
          workflowRef: "template_ugc_launch_v1",
          templateId: "tpl-ugc-launch",
          inputs: { brief: "DTC skincare launch", hooks: ["Clear skin in 7 days?", "No harsh routines"] },
          params: { style: "ugc", aspect: "9:16" }
        }
      },
      {
        id: "n-image",
        kind: "generation.image",
        x: 620,
        y: 70,
        title: "Comfy Image Node",
        subtitle: "Static ad concepts",
        config: {
          workflowRef: "comfy_image_ad_v1",
          inputs: { prompt: "Create 3 UGC skincare ad variants, high contrast, product in hand" },
          params: { count: 3, seed: 42, model: "sdxl" }
        }
      },
      {
        id: "n-video",
        kind: "generation.video",
        x: 620,
        y: 210,
        title: "Comfy Video Node",
        subtitle: "Short ad variant",
        config: {
          workflowRef: "comfy_video_ad_v1",
          inputs: { prompt: "7-second product demo with clear hook text" },
          params: { durationSec: 7, fps: 24, seed: 91, model: "wan-video" }
        }
      },
      {
        id: "n-audio",
        kind: "generation.audio",
        x: 620,
        y: 350,
        title: "ElevenLabs Voice Node",
        subtitle: "Voiceover variants",
        config: {
          workflowRef: "elevenlabs_voiceover_v1",
          inputs: {
            text: "Reveal clear skin with a routine that feels effortless. Tap to see your 7-day glow plan."
          },
          params: { voiceId: "EXAVITQu4vr4xnSDxMaL", model: "eleven_multilingual_v2" }
        }
      },
      {
        id: "n-music",
        kind: "generation.music",
        x: 620,
        y: 490,
        title: "ElevenLabs Music Node",
        subtitle: "Video-to-music variants",
        config: {
          workflowRef: "elevenlabs_video_to_music_v1",
          inputs: {
            videoUrl: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
            prompt: "Energetic upbeat ad soundtrack with punchy transitions"
          },
          params: { durationSec: 7 }
        }
      },
      { id: "n-brief", kind: "brief", x: 930, y: 120, title: "Output Review", subtitle: "Compare outputs" }
    ],
    edges: [
      { id: "e-1", from: "n-source", to: "n-template" },
      { id: "e-2", from: "n-template", to: "n-image" },
      { id: "e-3", from: "n-template", to: "n-video" },
      { id: "e-4", from: "n-template", to: "n-audio" },
      { id: "e-5", from: "n-template", to: "n-music" },
      { id: "e-6", from: "n-image", to: "n-brief" },
      { id: "e-7", from: "n-video", to: "n-brief" },
      { id: "e-8", from: "n-audio", to: "n-brief" },
      { id: "e-9", from: "n-music", to: "n-brief" }
    ]
  };
}

function ensureSeed(workspaceId: string) {
  const row = countFolders.get(workspaceId) as { count: number };
  if (row.count > 0) return;
  const folders: ProjectFolder[] = [
    { id: "f-research", workspaceId, name: "Research Sprints" },
    { id: "f-campaigns", workspaceId, name: "Campaign Launches" }
  ];
  const products: Product[] = [
    { id: "p-motion-canvas", folderId: "f-research", name: "Motion Canvas" },
    { id: "p-openflow-growth", folderId: "f-campaigns", name: "Openflow Growth (Golden Demo)" }
  ];
  const tx = db.transaction(() => {
    folders.forEach((f) => insertFolder.run(f.id, workspaceId, f.name));
    products.forEach((p) => insertProduct.run(p.id, workspaceId, p.folderId, p.name));
    products.forEach((p) => {
      const doc = seedDocument(p.id);
      upsertDoc.run(p.id, workspaceId, JSON.stringify(doc), doc.updatedAt);
    });
  });
  tx();
}

function getWorkspace(workspaceId: string): WorkspaceSnapshot {
  ensureSeed(workspaceId);
  const folders = readFolders.all(workspaceId) as ProjectFolder[];
  const products = readProducts.all(workspaceId) as Product[];
  const docs = readDocs.all(workspaceId) as Array<{ productId: string; docJson: string }>;
  const documents: Record<string, CanvasDocument> = {};
  for (const row of docs) documents[row.productId] = JSON.parse(row.docJson) as CanvasDocument;
  return { workspaceId, folders, products, documents };
}

function upsertCanvas(workspaceId: string, productId: string, doc: CanvasDocument): CanvasDocument {
  ensureSeed(workspaceId);
  const normalized: CanvasDocument = { ...doc, productId, updatedAt: nowIso() };
  upsertDoc.run(productId, workspaceId, JSON.stringify(normalized), normalized.updatedAt);
  return normalized;
}

function createProduct(workspaceId: string, folderId: string, name: string): Product {
  ensureSeed(workspaceId);
  const product: Product = { id: `p-${Date.now()}`, folderId, name };
  insertProduct.run(product.id, workspaceId, folderId, name);
  const doc = seedDocument(product.id);
  upsertDoc.run(product.id, workspaceId, JSON.stringify(doc), doc.updatedAt);
  return product;
}

function createRun(workspaceId: string, productId: string): GenerationRun {
  const run: GenerationRun = {
    id: newId("run"),
    workspaceId,
    productId,
    status: "queued",
    startedAt: nowIso(),
    completedAt: null,
    errorMessage: null
  };
  insertRunStmt.run(run.id, run.workspaceId, run.productId, run.status, run.startedAt, run.completedAt, run.errorMessage);
  return run;
}

function getRun(runId: string): GenerationRun | null {
  const run = readRunStmt.get(runId) as GenerationRun | undefined;
  return run ?? null;
}

function updateRunStatus(runId: string, status: RunStatus, errorMessage?: string | null): GenerationRun {
  const completedAt = status === "completed" || status === "failed" || status === "cancelled" ? nowIso() : null;
  updateRunStmt.run(status, completedAt, errorMessage ?? null, runId);
  return getRun(runId)!;
}

function listRuns(workspaceId: string, productId: string): GenerationRun[] {
  return readRunsStmt.all(workspaceId, productId) as GenerationRun[];
}

function createRunStep(runId: string, nodeId: string, nodeKind: string): GenerationRunStep {
  const step: GenerationRunStep = {
    id: newId("step"),
    runId,
    nodeId,
    nodeKind: nodeKind as CanvasNodeKind,
    status: "queued",
    startedAt: null,
    completedAt: null,
    errorCode: null,
    errorMessage: null,
    providerJobId: null,
    durationMs: null
  };
  insertStepStmt.run(
    step.id,
    step.runId,
    step.nodeId,
    step.nodeKind,
    step.status,
    step.startedAt,
    step.completedAt,
    step.errorCode,
    step.errorMessage,
    step.providerJobId,
    step.durationMs
  );
  return step;
}

function updateRunStep(
  stepId: string,
  patch: Partial<Pick<GenerationRunStep, "status" | "startedAt" | "completedAt" | "errorCode" | "errorMessage" | "providerJobId" | "durationMs">>
): GenerationRunStep {
  const current = db
    .prepare(
      `SELECT
        id,
        run_id as runId,
        node_id as nodeId,
        node_kind as nodeKind,
        status,
        started_at as startedAt,
        completed_at as completedAt,
        error_code as errorCode,
        error_message as errorMessage,
        provider_job_id as providerJobId,
        duration_ms as durationMs
      FROM generation_run_steps WHERE id = ? LIMIT 1`
    )
    .get(stepId) as GenerationRunStep | undefined;
  if (!current) throw new Error(`Run step not found: ${stepId}`);
  const merged: GenerationRunStep = { ...current, ...patch };
  updateStepStmt.run(
    merged.status,
    merged.startedAt ?? null,
    merged.completedAt ?? null,
    merged.errorCode ?? null,
    merged.errorMessage ?? null,
    merged.providerJobId ?? null,
    merged.durationMs ?? null,
    stepId
  );
  return merged;
}

function addArtifact(
  runId: string,
  stepId: string,
  type: "image" | "video" | "audio",
  uri: string,
  previewUri: string,
  metadata: Record<string, unknown>
) {
  const artifact: GenerationArtifact = {
    id: newId("art"),
    runId,
    stepId,
    type,
    uri,
    previewUri,
    metadata,
    createdAt: nowIso()
  };
  insertArtifactStmt.run(
    artifact.id,
    artifact.runId,
    artifact.stepId,
    artifact.type,
    artifact.uri,
    artifact.previewUri,
    JSON.stringify(artifact.metadata),
    artifact.createdAt
  );
  return artifact;
}

function getRunDetail(runId: string): GenerationRunDetail | null {
  const run = getRun(runId);
  if (!run) return null;
  const steps = readStepsStmt.all(runId) as GenerationRunStep[];
  const rows = readArtifactsStmt.all(runId) as Array<Omit<GenerationArtifact, "metadata"> & { metadataJson: string }>;
  const artifacts: GenerationArtifact[] = rows.map((row) => ({
    id: row.id,
    runId: row.runId,
    stepId: row.stepId,
    type: row.type,
    uri: row.uri,
    previewUri: row.previewUri,
    metadata: JSON.parse(row.metadataJson),
    createdAt: row.createdAt
  }));
  return { run, steps, artifacts };
}

async function submitWorkflow(request: GenerationJobRequest): Promise<GenerationJobResult> {
  if (request.workflowRef.startsWith("elevenlabs_")) {
    const id = newId("ej");
    elevenJobs.set(id, {
      id,
      request,
      createdAt: Date.now(),
      durationMs: 2200,
      fail: false
    });
    return { providerJobId: id };
  }

  const id = newId("cj");
  mockJobs.set(id, {
    id,
    request,
    createdAt: Date.now(),
    durationMs: 3500 + Math.floor(Math.random() * 1800),
    fail: false
  });
  return { providerJobId: id };
}

async function getJobStatus(providerJobId: string): Promise<GenerationJobStatusPayload> {
  const elevenJob = elevenJobs.get(providerJobId);
  if (elevenJob) {
    const elapsed = Date.now() - elevenJob.createdAt;
    if (elapsed < 350) return { providerJobId, status: "queued", progress: 0 };
    if (elapsed < elevenJob.durationMs) {
      return {
        providerJobId,
        status: "running",
        progress: Math.min(98, Math.floor((elapsed / elevenJob.durationMs) * 100)),
        startedAt: new Date(elevenJob.createdAt + 350).toISOString()
      };
    }
    return {
      providerJobId,
      status: "completed",
      progress: 100,
      startedAt: new Date(elevenJob.createdAt + 350).toISOString(),
      completedAt: nowIso()
    };
  }

  const job = mockJobs.get(providerJobId);
  if (!job) {
    return {
      providerJobId,
      status: "failed",
      progress: 0,
      errorCode: "provider_error",
      errorMessage: "Mock job not found"
    };
  }
  const elapsed = Date.now() - job.createdAt;
  if (elapsed < 800) return { providerJobId, status: "queued", progress: 0 };
  if (elapsed < job.durationMs) {
    return {
      providerJobId,
      status: "running",
      progress: Math.min(98, Math.floor((elapsed / job.durationMs) * 100)),
      startedAt: new Date(job.createdAt + 800).toISOString()
    };
  }
  if (job.fail) {
    return {
      providerJobId,
      status: "failed",
      progress: 100,
      startedAt: new Date(job.createdAt + 800).toISOString(),
      completedAt: nowIso(),
      errorCode: "workflow_error",
      errorMessage: "Simulated workflow failure"
    };
  }
  return {
    providerJobId,
    status: "completed",
    progress: 100,
    startedAt: new Date(job.createdAt + 800).toISOString(),
    completedAt: nowIso()
  };
}

async function fetchOutputs(providerJobId: string, runId: string, stepId: string): Promise<GenerationArtifact[]> {
  const elevenJob = elevenJobs.get(providerJobId);
  if (elevenJob) {
    return fetchElevenLabsOutputs(elevenJob, providerJobId, runId, stepId);
  }

  const mockJob = mockJobs.get(providerJobId);
  const workflowRef = String(mockJob?.request.workflowRef || "");
  const isVideo = workflowRef.includes("video");
  return [
    {
      id: "",
      runId,
      stepId,
      type: isVideo ? "video" : "image",
      uri: isVideo
        ? "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"
        : "https://picsum.photos/seed/openflow-image-1/1024/1024",
      previewUri: isVideo
        ? "https://picsum.photos/seed/openflow-video-preview-1/1024/576"
        : "https://picsum.photos/seed/openflow-image-1/512/512",
      metadata: {
        model: isVideo ? "wan-video" : "sdxl",
        seed: isVideo ? 91 : 42,
        providerJobId
      },
      createdAt: nowIso()
    }
  ];
}

async function fetchElevenLabsOutputs(
  job: JobState,
  providerJobId: string,
  runId: string,
  stepId: string
): Promise<GenerationArtifact[]> {
  if (job.request.workflowRef === "elevenlabs_video_to_music_v1") {
    return fetchElevenLabsMusicOutputs(job, providerJobId, runId, stepId);
  }
  return fetchElevenLabsVoiceOutputs(job, providerJobId, runId, stepId);
}

async function fetchElevenLabsVoiceOutputs(
  job: JobState,
  providerJobId: string,
  runId: string,
  stepId: string
): Promise<GenerationArtifact[]> {
  const elevenApiKey = resolveElevenApiKey(getDesktopSettings());
  const text =
    String(job.request.inputs?.text || "").trim() ||
    "Introducing Openflow: plan, generate, and monitor campaign-ready creative in one canvas.";
  const voiceId = String(job.request.params?.voiceId || "EXAVITQu4vr4xnSDxMaL");
  const modelId = String(job.request.params?.model || "eleven_multilingual_v2");
  const outputFormat = String(job.request.params?.outputFormat || "mp3_44100_128");
  const stability = Number(job.request.params?.stability ?? 0.5);
  const similarityBoost = Number(job.request.params?.similarityBoost ?? 0.75);

  if (elevenApiKey) {
    try {
      const res = await fetch(`${ELEVEN_API_BASE}/text-to-speech/${encodeURIComponent(voiceId)}`, {
        method: "POST",
        headers: {
          Accept: "audio/mpeg",
          "Content-Type": "application/json",
          "xi-api-key": elevenApiKey
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
          output_format: outputFormat,
          voice_settings: {
            stability,
            similarity_boost: similarityBoost
          }
        })
      });
      if (res.ok) {
        const audioBuffer = Buffer.from(await res.arrayBuffer());
        const audioDataUri = `data:audio/mpeg;base64,${audioBuffer.toString("base64")}`;
        const previewUri =
          "data:image/svg+xml;utf8," +
          encodeURIComponent(
            "<svg xmlns='http://www.w3.org/2000/svg' width='640' height='360'><rect width='100%' height='100%' fill='#111827'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='#f9fafb' font-family='Arial' font-size='26'>ElevenLabs Voiceover</text></svg>"
          );
        return [
          {
            id: "",
            runId,
            stepId,
            type: "audio",
            uri: audioDataUri,
            previewUri,
            metadata: {
              provider: "elevenlabs",
              voiceId,
              model: modelId,
              outputFormat,
              textLength: text.length,
              providerJobId
            },
            createdAt: nowIso()
          }
        ];
      }
    } catch {
      // Fall through to mock output.
    }
  }

  return [
    {
      id: "",
      runId,
      stepId,
      type: "audio",
      uri: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
      previewUri:
        "data:image/svg+xml;utf8," +
        encodeURIComponent(
          "<svg xmlns='http://www.w3.org/2000/svg' width='640' height='360'><rect width='100%' height='100%' fill='#0f172a'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='#e2e8f0' font-family='Arial' font-size='24'>Voiceover Mock</text></svg>"
        ),
      metadata: {
        provider: elevenApiKey ? "elevenlabs-fallback" : "mock",
        voiceId,
        model: modelId,
        outputFormat,
        textLength: text.length,
        providerJobId
      },
      createdAt: nowIso()
    }
  ];
}

async function fetchElevenLabsMusicOutputs(
  job: JobState,
  providerJobId: string,
  runId: string,
  stepId: string
): Promise<GenerationArtifact[]> {
  const elevenApiKey = resolveElevenApiKey(getDesktopSettings());
  const videoUrl =
    String(job.request.inputs?.videoUrl || "").trim() ||
    "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";
  const prompt =
    String(job.request.inputs?.prompt || "").trim() || "Energetic ad soundtrack that tracks the visual pacing.";
  const durationSec = Number(job.request.params?.durationSec ?? 7);

  if (elevenApiKey) {
    try {
      const res = await fetch(`${ELEVEN_API_BASE}/music/video-to-music`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": elevenApiKey
        },
        body: JSON.stringify({
          video_url: videoUrl,
          prompt,
          duration_seconds: durationSec
        })
      });
      if (res.ok) {
        const body = (await res.json()) as Record<string, unknown>;
        const musicUri = pickUrlFromResponse(body, ["music_url", "audio_url", "url", "output_url", "download_url"]);
        if (musicUri) {
          return [
            {
              id: "",
              runId,
              stepId,
              type: "audio",
              uri: musicUri,
              previewUri:
                "data:image/svg+xml;utf8," +
                encodeURIComponent(
                  "<svg xmlns='http://www.w3.org/2000/svg' width='640' height='360'><rect width='100%' height='100%' fill='#111827'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='#f9fafb' font-family='Arial' font-size='25'>ElevenLabs Video to Music</text></svg>"
                ),
              metadata: {
                provider: "elevenlabs",
                workflowRef: "elevenlabs_video_to_music_v1",
                prompt,
                durationSec,
                videoUrl,
                providerJobId
              },
              createdAt: nowIso()
            }
          ];
        }
      }
    } catch {
      // Fall through to mock output.
    }
  }

  return [
    {
      id: "",
      runId,
      stepId,
      type: "audio",
      uri: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
      previewUri:
        "data:image/svg+xml;utf8," +
        encodeURIComponent(
          "<svg xmlns='http://www.w3.org/2000/svg' width='640' height='360'><rect width='100%' height='100%' fill='#0f172a'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='#e2e8f0' font-family='Arial' font-size='24'>Music Mock</text></svg>"
        ),
      metadata: {
        provider: elevenApiKey ? "elevenlabs-fallback" : "mock",
        workflowRef: "elevenlabs_video_to_music_v1",
        prompt,
        durationSec,
        videoUrl,
        providerJobId
      },
      createdAt: nowIso()
    }
  ];
}

function pickUrlFromResponse(body: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const direct = body[key];
    if (typeof direct === "string" && direct.length > 0) return direct;
  }
  const nested = body.data;
  if (nested && typeof nested === "object") {
    for (const key of keys) {
      const value = (nested as Record<string, unknown>)[key];
      if (typeof value === "string" && value.length > 0) return value;
    }
  }
  return null;
}

function isExecutableKind(kind: CanvasNode["kind"]) {
  return kind !== "brief";
}

function collectSelectedWithAncestors(doc: CanvasDocument, selectedNodeIds?: string[]) {
  if (!selectedNodeIds?.length) return new Set(doc.nodes.map((n) => n.id));
  const incoming = new Map<string, string[]>();
  for (const edge of doc.edges || []) {
    if (!incoming.has(edge.to)) incoming.set(edge.to, []);
    incoming.get(edge.to)!.push(edge.from);
  }
  const selected = new Set(selectedNodeIds);
  const stack = [...selectedNodeIds];
  while (stack.length) {
    const id = stack.pop()!;
    const parents = incoming.get(id) || [];
    for (const parent of parents) {
      if (!selected.has(parent)) {
        selected.add(parent);
        stack.push(parent);
      }
    }
  }
  return selected;
}

function topologicalExecutableNodes(doc: CanvasDocument, nodeIds?: string[]): CanvasNode[] {
  const nodeMap = new Map(doc.nodes.map((n) => [n.id, n]));
  const selected = collectSelectedWithAncestors(doc, nodeIds);
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const node of doc.nodes) {
    if (!selected.has(node.id) || !isExecutableKind(node.kind)) continue;
    indegree.set(node.id, 0);
    outgoing.set(node.id, []);
  }
  for (const edge of doc.edges || []) {
    if (!indegree.has(edge.from) || !indegree.has(edge.to)) continue;
    outgoing.get(edge.from)!.push(edge.to);
    indegree.set(edge.to, (indegree.get(edge.to) || 0) + 1);
  }
  const queue = [...indegree.entries()].filter(([, deg]) => deg === 0).map(([id]) => id);
  const ordered: CanvasNode[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    const node = nodeMap.get(id);
    if (node) ordered.push(node);
    for (const to of outgoing.get(id) || []) {
      const next = (indegree.get(to) || 0) - 1;
      indegree.set(to, next);
      if (next === 0) queue.push(to);
    }
  }
  if (ordered.length < indegree.size) {
    for (const id of indegree.keys()) {
      if (!ordered.find((n) => n.id === id)) {
        const node = nodeMap.get(id);
        if (node) ordered.push(node);
      }
    }
  }
  return ordered;
}

function isCancelled(runId: string) {
  return runCancellationMap.get(runId)?.cancelled === true;
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));
const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });
const workspaceSockets = new Map<string, Set<any>>();

function broadcast(workspaceId: string, event: WorkspaceEvent) {
  const sockets = workspaceSockets.get(workspaceId);
  if (!sockets) return;
  const message = JSON.stringify(event);
  sockets.forEach((ws: any) => {
    if (ws.readyState === 1) ws.send(message);
  });
}

function emitStepUpdate(workspaceId: string, productId: string, runId: string, step: GenerationRunStep) {
  broadcast(workspaceId, {
    type: "run.step.updated",
    workspaceId,
    productId,
    runId,
    step,
    updatedAt: nowIso()
  });
}

async function completeStepWithArtifacts(
  workspaceId: string,
  productId: string,
  runId: string,
  stepId: string,
  nodeId: string,
  artifacts: GenerationArtifact[]
) {
  for (const generated of artifacts) {
    const stored = addArtifact(
      runId,
      stepId,
      generated.type,
      generated.uri,
      generated.previewUri,
      generated.metadata || {}
    );
    broadcast(workspaceId, {
      type: "generation.artifact.created",
      workspaceId,
      productId,
      runId,
      nodeId,
      artifact: stored,
      updatedAt: nowIso()
    });
    broadcast(workspaceId, {
      type: "run.artifact.created",
      workspaceId,
      productId,
      runId,
      artifact: stored,
      updatedAt: nowIso()
    });
  }
}

function isGenerationKind(kind: CanvasNode["kind"]) {
  return (
    kind === "generation.image" ||
    kind === "generation.video" ||
    kind === "generation.audio" ||
    kind === "generation.music" ||
    kind === "generation.template"
  );
}

function validateBlueprintConfig(node: CanvasNode) {
  const blueprint = getBlueprintById(node.config?.blueprintId);
  if (!blueprint) return { ok: true as const };
  if (blueprint.category === "generation" && !String(node.config?.workflowRef || "").trim()) {
    return { ok: false as const, error: "workflowRef is required for generation nodes" };
  }
  return { ok: true as const };
}

function validateConnectionScopes(node: CanvasNode, workspaceId: string) {
  const blueprint = getBlueprintById(node.config?.blueprintId);
  if (!blueprint?.connection) return { ok: true as const };
  const conn = getWorkspaceProviderConnection(workspaceId, blueprint.connection.provider);
  if (!conn) return { ok: false as const, error: `${blueprint.connection.provider} is not connected` };
  if (conn.state !== "connected") return { ok: false as const, error: `${conn.provider} is ${conn.state}` };
  const required = blueprint.connection.scopes || [];
  if (required.length && !required.every((scope) => conn.scopes.includes(scope))) {
    return { ok: false as const, error: `Missing required scopes for ${conn.provider}` };
  }
  return { ok: true as const };
}

async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = 25_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 160)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function requireProviderToken(workspaceId: string, provider: string) {
  const token = getWorkspaceProviderToken(workspaceId, provider);
  if (!token) throw new Error(`Missing token for provider ${provider}`);
  return token;
}

async function runSourceOrAgentBlueprint(workspaceId: string, node: CanvasNode) {
  const blueprintId = String(node.config?.blueprintId || "");
  const blueprint = getBlueprintById(blueprintId);
  if (blueprintId === "src_reddit_scraper") {
    const result = await runRedditScraper({
      brandAnalysis: (node.config?.inputs?.brandAnalysis || {}) as any,
      queries: Array.isArray(node.config?.inputs?.queries) ? (node.config?.inputs?.queries as string[]) : undefined,
      subreddits: Array.isArray(node.config?.inputs?.subreddits) ? (node.config?.inputs?.subreddits as string[]) : undefined
    });
    return { summary: `Reddit findings: ${result.findings.length}` };
  }
  if (blueprintId === "src_amazon_reviews_scraper") {
    const token = requireProviderToken(workspaceId, "apify");
    const productQuery = String(node.config?.inputs?.query || node.config?.inputs?.product || "best moisturizer");
    const actorId = String(node.config?.params?.actorId || "epctex~amazon-reviews-scraper");
    const run = await fetchJson(`https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/runs?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keyword: productQuery, maxReviews: Number(node.config?.params?.maxReviews || 100) })
    });
    return { summary: `Amazon scrape run started: ${String((run as any)?.data?.id || "ok")}` };
  }
  if (blueprintId === "src_interview_transcripts_gdrive") {
    const token = requireProviderToken(workspaceId, "google_drive");
    const q = encodeURIComponent(String(node.config?.params?.query || "mimeType!='application/vnd.google-apps.folder'"));
    const fields = encodeURIComponent("files(id,name,mimeType,modifiedTime),nextPageToken");
    const data = await fetchJson(`https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=25&fields=${fields}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const files = Array.isArray((data as any).files) ? (data as any).files : [];
    return { summary: `GDrive files ingested: ${files.length}` };
  }
  if (blueprintId === "src_slack_channel_reader") {
    const token = requireProviderToken(workspaceId, "slack");
    const channel = String(node.config?.params?.channel || node.config?.inputs?.channel || "");
    if (!channel) throw new Error("Slack channel is required in node params.channel");
    const qs = new URLSearchParams({ channel, limit: String(node.config?.params?.limit || 100) });
    const data = await fetchJson(`https://slack.com/api/conversations.history?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!(data as any).ok) throw new Error(`Slack API failed: ${String((data as any).error || "unknown_error")}`);
    const msgs = Array.isArray((data as any).messages) ? (data as any).messages : [];
    return { summary: `Slack messages ingested: ${msgs.length}` };
  }
  if (blueprintId === "src_motion_analytics_ingest") {
    const token = requireProviderToken(workspaceId, "motion");
    const base = String(node.config?.params?.baseUrl || process.env.MOTION_API_BASE || "").trim().replace(/\/+$/, "");
    if (!base) throw new Error("MOTION_API_BASE missing");
    const path = String(node.config?.params?.path || "/reports/latest");
    const data = await fetchJson(`${base}${path.startsWith("/") ? path : `/${path}`}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const count = Array.isArray((data as any).items) ? (data as any).items.length : Object.keys((data as any) || {}).length;
    return { summary: `Motion records ingested: ${count}` };
  }
  if (blueprintId === "src_meta_ads_metrics_ingest") {
    const token = requireProviderToken(workspaceId, "meta");
    const accountId = String(node.config?.params?.adAccountId || node.config?.inputs?.adAccountId || "").replace(/^act_/, "");
    if (!accountId) throw new Error("adAccountId is required");
    const fields = encodeURIComponent(String(node.config?.params?.fields || "impressions,clicks,spend,cpc,ctr,actions"));
    const data = await fetchJson(
      `https://graph.facebook.com/v20.0/act_${accountId}/insights?fields=${fields}&limit=${Number(node.config?.params?.limit || 50)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const rows = Array.isArray((data as any).data) ? (data as any).data : [];
    return { summary: `Meta insights rows: ${rows.length}` };
  }
  if (blueprintId === "src_meta_pixel_ingest") {
    const token = requireProviderToken(workspaceId, "meta_pixel");
    const pixelId = String(node.config?.params?.pixelId || node.config?.inputs?.pixelId || "");
    if (!pixelId) throw new Error("pixelId is required");
    const data = await fetchJson(`https://graph.facebook.com/v20.0/${encodeURIComponent(pixelId)}?fields=id,name,last_fired_time`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return { summary: `Meta pixel connected: ${String((data as any).name || (data as any).id || pixelId)}` };
  }
  if (blueprintId === "src_shopify_ingest") {
    const token = requireProviderToken(workspaceId, "shopify");
    const shopDomain = String(node.config?.params?.shopDomain || node.config?.inputs?.shopDomain || "");
    if (!shopDomain) throw new Error("shopDomain is required");
    const data = await fetchJson(`https://${shopDomain}/admin/api/2024-10/orders.json?limit=${Number(node.config?.params?.limit || 50)}`, {
      headers: {
        "X-Shopify-Access-Token": token,
        "content-type": "application/json"
      }
    });
    const orders = Array.isArray((data as any).orders) ? (data as any).orders : [];
    return { summary: `Shopify orders ingested: ${orders.length}` };
  }
  if (blueprintId === "src_notion_docs_ingest") {
    const token = requireProviderToken(workspaceId, "notion");
    const data = await fetchJson("https://api.notion.com/v1/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": String(node.config?.params?.notionVersion || "2022-06-28"),
        "content-type": "application/json"
      },
      body: JSON.stringify({
        page_size: Number(node.config?.params?.pageSize || 25),
        ...(node.config?.inputs?.query ? { query: String(node.config.inputs.query) } : {})
      })
    });
    const results = Array.isArray((data as any).results) ? (data as any).results : [];
    return { summary: `Notion docs ingested: ${results.length}` };
  }
  if (blueprintId === "src_semrush_ingest") {
    const token = requireProviderToken(workspaceId, "semrush");
    const domain = String(node.config?.inputs?.domain || node.config?.params?.domain || "");
    if (!domain) throw new Error("domain is required");
    const database = String(node.config?.params?.database || "us");
    const type = String(node.config?.params?.type || "domain_ranks");
    const url = `https://api.semrush.com/?type=${encodeURIComponent(type)}&key=${encodeURIComponent(token)}&export_columns=Dn,Rk,Or,Ot,Oc,Ad,At,Ac&domain=${encodeURIComponent(domain)}&database=${encodeURIComponent(database)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`SEMrush HTTP ${res.status}`);
    const text = await res.text();
    const lines = text.trim().split("\n").filter(Boolean);
    return { summary: `SEMrush rows ingested: ${Math.max(0, lines.length - 1)}` };
  }
  if (blueprintId === "src_klaviyo_ingest") {
    const token = requireProviderToken(workspaceId, "klaviyo");
    const endpoint = String(node.config?.params?.endpoint || "/profiles/");
    const data = await fetchJson(`https://a.klaviyo.com/api${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`, {
      headers: {
        Authorization: `Klaviyo-API-Key ${token}`,
        Revision: String(node.config?.params?.revision || "2024-07-15")
      }
    });
    const rows = Array.isArray((data as any).data) ? (data as any).data : [];
    return { summary: `Klaviyo rows ingested: ${rows.length}` };
  }
  if (blueprintId === "src_gsc_ingest") {
    const token = requireProviderToken(workspaceId, "google_search_console");
    const siteUrl = String(node.config?.inputs?.siteUrl || node.config?.params?.siteUrl || "");
    if (!siteUrl) throw new Error("siteUrl is required");
    const body = {
      startDate: String(node.config?.params?.startDate || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)),
      endDate: String(node.config?.params?.endDate || new Date().toISOString().slice(0, 10)),
      dimensions: (Array.isArray(node.config?.params?.dimensions) ? node.config?.params?.dimensions : ["query"]) as string[],
      rowLimit: Number(node.config?.params?.rowLimit || 100)
    };
    const data = await fetchJson(
      `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body)
      }
    );
    const rows = Array.isArray((data as any).rows) ? (data as any).rows : [];
    return { summary: `GSC rows ingested: ${rows.length}` };
  }
  if (blueprintId === "src_ga4_ingest") {
    const token = requireProviderToken(workspaceId, "ga4");
    const propertyId = String(node.config?.inputs?.propertyId || node.config?.params?.propertyId || "");
    if (!propertyId) throw new Error("propertyId is required");
    const data = await fetchJson(
      `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          dimensions: [{ name: String(node.config?.params?.dimension || "date") }],
          metrics: [{ name: String(node.config?.params?.metric || "sessions") }],
          dateRanges: [
            {
              startDate: String(node.config?.params?.startDate || "7daysAgo"),
              endDate: String(node.config?.params?.endDate || "today")
            }
          ],
          limit: Number(node.config?.params?.limit || 100)
        })
      }
    );
    const rows = Array.isArray((data as any).rows) ? (data as any).rows : [];
    return { summary: `GA4 rows ingested: ${rows.length}` };
  }
  if (blueprintId === "src_youtube_analytics_ingest") {
    const token = requireProviderToken(workspaceId, "youtube");
    const ids = String(node.config?.params?.ids || "channel==MINE");
    const startDate = String(node.config?.params?.startDate || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));
    const endDate = String(node.config?.params?.endDate || new Date().toISOString().slice(0, 10));
    const metrics = String(node.config?.params?.metrics || "views,estimatedMinutesWatched,averageViewDuration");
    const dimensions = String(node.config?.params?.dimensions || "day");
    const data = await fetchJson(
      `https://youtubeanalytics.googleapis.com/v2/reports?ids=${encodeURIComponent(ids)}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&metrics=${encodeURIComponent(metrics)}&dimensions=${encodeURIComponent(dimensions)}`,
      {
        headers: { Authorization: `Bearer ${token}` }
      }
    );
    const rows = Array.isArray((data as any).rows) ? (data as any).rows : [];
    return { summary: `YouTube analytics rows: ${rows.length}` };
  }
  if (blueprintId === "customer_objections_agent") {
    const findings = Array.isArray(node.config?.inputs?.findings) ? (node.config?.inputs?.findings as any[]) : [];
    const result = await runPersonaNeedEmotion({
      brandAnalysis: (node.config?.inputs?.brandAnalysis || {}) as any,
      findings: findings as any
    });
    return { summary: `Persona items: ${result.items.length}` };
  }
  if (blueprintId === "pne_framework") {
    const items = Array.isArray(node.config?.inputs?.items) ? (node.config?.inputs?.items as any[]) : [];
    const result = runPneFramework({ items: items as any, limit: Number(node.config?.params?.limit || 12) });
    return { summary: `PNE combinations: ${result.pneCombos.length}` };
  }
  if (blueprintId === "pub_meta_ads_scheduler") {
    const token = requireProviderToken(workspaceId, "meta");
    const accountId = String(node.config?.params?.adAccountId || node.config?.inputs?.adAccountId || "").replace(/^act_/, "");
    if (!accountId) throw new Error("adAccountId is required");
    const campaignName = String(node.config?.inputs?.campaignName || `Openflow Campaign ${new Date().toISOString().slice(0, 10)}`);
    const objective = String(node.config?.params?.objective || "OUTCOME_TRAFFIC");
    const body = new URLSearchParams({
      name: campaignName,
      objective,
      status: String(node.config?.params?.status || "PAUSED"),
      special_ad_categories: "[]"
    });
    const data = await fetchJson(`https://graph.facebook.com/v20.0/act_${accountId}/campaigns`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });
    return { summary: `Meta campaign created: ${String((data as any).id || "ok")}` };
  }
  if (blueprintId === "pub_budget_allocator_agent") {
    const budget = Number(node.config?.inputs?.totalBudget || node.config?.params?.totalBudget || 1000);
    const splits = {
      trigger: Math.round(budget * 0.15),
      exploration: Math.round(budget * 0.25),
      evaluation: Math.round(budget * 0.4),
      purchase: Math.round(budget * 0.2)
    };
    return { summary: `Budget allocated (${budget})`, splits };
  }
  if (blueprintId === "brief_synthesizer") {
    return { summary: "Strategic brief synthesized from connected nodes" };
  }
  if (blueprintId === "creative_plan_synthesizer") {
    return { summary: "Creative sprint plan synthesized" };
  }
  if (blueprint?.connection) {
    const token = requireProviderToken(workspaceId, blueprint.connection.provider);
    const baseUrl = String(node.config?.params?.baseUrl || "").trim().replace(/\/+$/, "");
    const endpoint = String(node.config?.params?.endpoint || "").trim();
    if (!baseUrl || !endpoint) {
      throw new Error(`Node ${blueprintId} requires params.baseUrl and params.endpoint for live handler`);
    }
    const method = String(node.config?.params?.method || "GET").toUpperCase();
    const headers: Record<string, string> = {
      ...(method === "GET" ? {} : { "content-type": "application/json" })
    };
    if (blueprint.connection.authType === "oauth") {
      headers.Authorization = `Bearer ${token}`;
    } else {
      headers["x-api-key"] = token;
    }
    const body =
      method === "GET" || method === "HEAD"
        ? undefined
        : JSON.stringify({
            inputs: node.config?.inputs || {},
            params: node.config?.params || {}
          });
    const data = await fetchJson(`${baseUrl}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`, {
      method,
      headers,
      body
    });
    const count = Array.isArray((data as any).items)
      ? (data as any).items.length
      : Array.isArray((data as any).data)
        ? (data as any).data.length
        : Object.keys((data as any) || {}).length;
    return { summary: `${blueprint.name} ingested records: ${count}` };
  }
  await sleep(200);
  return { summary: "Completed" };
}

async function runExecutableNode(workspaceId: string, productId: string, runId: string, node: CanvasNode) {
  const step = createRunStep(runId, node.id, node.kind);
  const startedAt = Date.now();
  let updated = updateRunStep(step.id, { status: "running", startedAt: nowIso() });
  emitStepUpdate(workspaceId, productId, runId, updated);
  const settings = getDesktopSettings();
  const configValidation = validateBlueprintConfig(node);
  if (!configValidation.ok) {
    updated = updateRunStep(step.id, {
      status: "failed",
      completedAt: nowIso(),
      durationMs: Date.now() - startedAt,
      errorCode: "workflow_error",
      errorMessage: configValidation.error
    });
    emitStepUpdate(workspaceId, productId, runId, updated);
    throw new Error(configValidation.error);
  }
  const connectionValidation = validateConnectionScopes(node, workspaceId);
  if (!connectionValidation.ok) {
    updated = updateRunStep(step.id, {
      status: "failed",
      completedAt: nowIso(),
      durationMs: Date.now() - startedAt,
      errorCode: "provider_error",
      errorMessage: connectionValidation.error
    });
    emitStepUpdate(workspaceId, productId, runId, updated);
    throw new Error(connectionValidation.error);
  }

  if (isAgenticNode(node) && !(await canUseAgenticFeatures(settings))) {
    updated = updateRunStep(step.id, {
      status: "failed",
      completedAt: nowIso(),
      durationMs: Date.now() - startedAt,
      errorCode: "provider_error",
      errorMessage: "Agentic features require Openflow Pro token or your own LLM API keys in Desktop settings."
    });
    emitStepUpdate(workspaceId, productId, runId, updated);
    throw new Error("agentic-gated");
  }

  if (!isGenerationKind(node.kind)) {
    const blueprint = getBlueprintById(node.config?.blueprintId);
    let result: Record<string, unknown> = { summary: "Completed" };
    if (blueprint?.category === "data_store" && blueprint.id && DATA_STORE_BLUEPRINT_IDS.has(blueprint.id)) {
      const payload =
        (node.config?.inputs && typeof node.config.inputs === "object" ? (node.config.inputs as Record<string, unknown>) : {}) || {};
      const stored = addDataStoreRecord(blueprint.id, workspaceId, node.id, runId, payload);
      result = { summary: `Stored record ${stored.id}`, storedId: stored.id };
    } else {
      result = (await runSourceOrAgentBlueprint(workspaceId, node)) as Record<string, unknown>;
    }
    updated = updateRunStep(step.id, {
      status: "completed",
      completedAt: nowIso(),
      durationMs: Date.now() - startedAt
    });
    emitStepUpdate(workspaceId, productId, runId, updated);
    if (result.summary) {
      broadcast(workspaceId, {
        type: "generation.job.updated",
        workspaceId,
        productId,
        runId,
        nodeId: node.id,
        job: {
          providerJobId: step.id,
          status: "completed",
          progress: 100,
          completedAt: nowIso()
        },
        updatedAt: nowIso()
      });
    }
    return;
  }

  if (node.kind === "generation.template") {
    await sleep(300);
    updated = updateRunStep(step.id, {
      status: "completed",
      completedAt: nowIso(),
      durationMs: Date.now() - startedAt
    });
    emitStepUpdate(workspaceId, productId, runId, updated);
    return;
  }

  const workflowRef =
    node.config?.workflowRef ||
    (node.kind === "generation.video"
      ? "comfy_video_ad_v1"
      : node.kind === "generation.audio"
        ? "elevenlabs_voiceover_v1"
        : node.kind === "generation.music"
          ? "elevenlabs_video_to_music_v1"
        : "comfy_image_ad_v1");
  const request: GenerationJobRequest = {
    workflowRef,
    inputs: (node.config?.inputs || {}) as Record<string, unknown>,
    params: (node.config?.params || {}) as Record<string, unknown>,
    metadata: { workspaceId, productId, runId, nodeId: node.id },
    idempotencyKey: `${runId}:${node.id}:${workflowRef}`
  };

  const job = await submitWorkflow(request);
  updated = updateRunStep(step.id, { providerJobId: job.providerJobId });
  emitStepUpdate(workspaceId, productId, runId, updated);

  broadcast(workspaceId, {
    type: "generation.job.submitted",
    workspaceId,
    productId,
    runId,
    nodeId: node.id,
    job,
    updatedAt: nowIso()
  });

  const pollStart = Date.now();
  const timeoutMs = 45_000;
  while (Date.now() - pollStart < timeoutMs) {
    if (isCancelled(runId)) throw new Error("cancelled");
    const jobStatus = await getJobStatus(job.providerJobId);
    broadcast(workspaceId, {
      type: "generation.job.updated",
      workspaceId,
      productId,
      runId,
      nodeId: node.id,
      job: jobStatus,
      updatedAt: nowIso()
    });
    if (jobStatus.status === "completed") {
      const outputs = await fetchOutputs(job.providerJobId, runId, step.id);
      await completeStepWithArtifacts(workspaceId, productId, runId, step.id, node.id, outputs);
      updated = updateRunStep(step.id, {
        status: "completed",
        completedAt: nowIso(),
        durationMs: Date.now() - startedAt
      });
      emitStepUpdate(workspaceId, productId, runId, updated);
      return;
    }
    if (jobStatus.status === "failed") {
      updated = updateRunStep(step.id, {
        status: "failed",
        completedAt: nowIso(),
        durationMs: Date.now() - startedAt,
        errorCode: jobStatus.errorCode || "provider_error",
        errorMessage: jobStatus.errorMessage || "Generation job failed"
      });
      emitStepUpdate(workspaceId, productId, runId, updated);
      broadcast(workspaceId, {
        type: "generation.job.failed",
        workspaceId,
        productId,
        runId,
        nodeId: node.id,
        job: jobStatus,
        updatedAt: nowIso()
      });
      throw new Error(jobStatus.errorMessage || "generation-failed");
    }
    await sleep(700);
  }

  updated = updateRunStep(step.id, {
    status: "failed",
    completedAt: nowIso(),
    durationMs: Date.now() - startedAt,
    errorCode: "timeout",
    errorMessage: "Generation job timed out"
  });
  emitStepUpdate(workspaceId, productId, runId, updated);
  throw new Error("timeout");
}

async function executeRun(workspaceId: string, productId: string, runId: string, doc: CanvasDocument, nodeIds?: string[]) {
  updateRunStatus(runId, "running");
  const run = getRun(runId);
  if (run) {
    broadcast(workspaceId, {
      type: "run.started",
      workspaceId,
      productId,
      run,
      updatedAt: nowIso()
    });
  }

  const generationNodes = topologicalExecutableNodes(doc, nodeIds);
  try {
    for (const node of generationNodes) {
      if (isCancelled(runId)) {
        updateRunStatus(runId, "cancelled");
        break;
      }
      await runExecutableNode(workspaceId, productId, runId, node);
    }

    if (isCancelled(runId)) {
      const cancelledRun = updateRunStatus(runId, "cancelled");
      broadcast(workspaceId, { type: "run.failed", workspaceId, productId, run: cancelledRun, updatedAt: nowIso() });
    } else {
      const completedRun = updateRunStatus(runId, "completed");
      broadcast(workspaceId, { type: "run.completed", workspaceId, productId, run: completedRun, updatedAt: nowIso() });
    }
  } catch (error: any) {
    const message = error?.message || "Run execution failed";
    const failedRun = updateRunStatus(runId, "failed", message);
    broadcast(workspaceId, { type: "run.failed", workspaceId, productId, run: failedRun, updatedAt: nowIso() });
  } finally {
    runCancellationMap.delete(runId);
  }
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, local: true, generation: true, db: DB_PATH });
});

const comfyImportBoot = importComfyTemplatesFromRepo();
if (comfyImportBoot.imported > 0) {
  console.log(
    `[ComfyTemplates] imported ${comfyImportBoot.imported} templates (${comfyImportBoot.skipped} skipped)`
  );
}

app.get("/settings", (_req, res) => {
  res.json(getDesktopSettings());
});

app.put("/settings", (req, res) => {
  const updated = patchDesktopSettings((req.body || {}) as Partial<DesktopSettings>);
  res.json(updated);
});

app.get("/blueprints/catalog", (_req, res) => {
  res.json(listNodeBlueprints());
});

app.post("/workspaces/:workspaceId/connections/:provider/connect", (req, res) => {
  const hostedBase = resolveHostedApiBase(getDesktopSettings());
  if (hostedBase) {
    void proxyHostedRequest(req, res, hostedBase).catch((error: any) => {
      res.status(502).json({ error: error?.message || "Hosted backend proxy failed" });
    });
    return;
  }
  const workspaceId = req.params.workspaceId || WORKSPACE_DEFAULT;
  const provider = String(req.params.provider || "").trim();
  if (!provider) {
    res.status(400).json({ error: "provider is required" });
    return;
  }
  const stateRaw = String(req.body?.state || "connected");
  const state: WorkspaceProviderConnection["state"] =
    stateRaw === "disconnected" || stateRaw === "expired" || stateRaw === "scope_missing" ? stateRaw : "connected";
  const authTypeRaw = String(req.body?.authType || "api_key");
  const authType: WorkspaceProviderConnection["authType"] = authTypeRaw === "oauth" ? "oauth" : "api_key";
  const scopes = Array.isArray(req.body?.scopes) ? req.body.scopes.map((s: unknown) => String(s)) : [];
  const connection = upsertWorkspaceProviderConnection(workspaceId, provider, {
    state,
    authType,
    account: req.body?.account ? String(req.body.account) : undefined,
    token: req.body?.token ? String(req.body.token) : undefined,
    scopes
  });
  res.json(connection);
});

app.get("/workspaces/:workspaceId/providers/:provider/status", (req, res) => {
  const hostedBase = resolveHostedApiBase(getDesktopSettings());
  if (hostedBase) {
    void proxyHostedRequest(req, res, hostedBase).catch((error: any) => {
      res.status(502).json({ error: error?.message || "Hosted backend proxy failed" });
    });
    return;
  }
  const workspaceId = req.params.workspaceId || WORKSPACE_DEFAULT;
  const provider = String(req.params.provider || "").trim();
  const connection = getWorkspaceProviderConnection(workspaceId, provider);
  if (!connection) {
    res.status(404).json({ provider, state: "disconnected" });
    return;
  }
  res.json(connection);
});

app.get("/workspaces/:workspaceId/connections", (req, res) => {
  const hostedBase = resolveHostedApiBase(getDesktopSettings());
  if (hostedBase) {
    void proxyHostedRequest(req, res, hostedBase).catch((error: any) => {
      res.status(502).json({ error: error?.message || "Hosted backend proxy failed" });
    });
    return;
  }
  const workspaceId = req.params.workspaceId || WORKSPACE_DEFAULT;
  res.json(listWorkspaceProviderConnections(workspaceId));
});

app.get("/workspaces/:workspaceId/data-stores/:storeId", (req, res) => {
  const hostedBase = resolveHostedApiBase(getDesktopSettings());
  if (hostedBase) {
    void proxyHostedRequest(req, res, hostedBase).catch((error: any) => {
      res.status(502).json({ error: error?.message || "Hosted backend proxy failed" });
    });
    return;
  }
  const workspaceId = req.params.workspaceId || WORKSPACE_DEFAULT;
  const storeId = String(req.params.storeId || "");
  if (!DATA_STORE_BLUEPRINT_IDS.has(storeId)) {
    res.status(404).json({ error: `Unknown data store: ${storeId}` });
    return;
  }
  const limit = Number(req.query.limit || 50);
  res.json(listRecentDataStoreRecords(storeId, workspaceId, Number.isFinite(limit) ? limit : 50));
});

app.get("/agents/catalog", (_req, res) => {
  res.json([
    { key: "reddit_scraper", name: "Reddit Scraper Agent", stage: "research" },
    { key: "persona_needs_emotions", name: "Persona/Needs/Emotion Agent", stage: "strategy" },
    { key: "pne_framework", name: "PNE Framework Agent", stage: "strategy" }
  ]);
});

app.post("/agents/reddit/scrape", async (req, res) => {
  try {
    const brandAnalysis = (req.body?.brandAnalysis || {}) as Record<string, unknown>;
    const queries = Array.isArray(req.body?.queries) ? req.body.queries.filter((v: unknown) => typeof v === "string") : undefined;
    const subreddits = Array.isArray(req.body?.subreddits)
      ? req.body.subreddits.filter((v: unknown) => typeof v === "string")
      : undefined;
    const result = await runRedditScraper({ brandAnalysis: brandAnalysis as any, queries, subreddits });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "reddit_scraper_failed" });
  }
});

app.post("/agents/persona-needs-emotions", async (req, res) => {
  try {
    const brandAnalysis = (req.body?.brandAnalysis || {}) as Record<string, unknown>;
    const findings = Array.isArray(req.body?.findings) ? req.body.findings : [];
    const result = await runPersonaNeedEmotion({ brandAnalysis: brandAnalysis as any, findings: findings as any });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "persona_needs_emotions_failed" });
  }
});

app.post("/agents/pne-framework", (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const limit = Number(req.body?.limit || 12);
    const result = runPneFramework({ items: items as any, limit: Number.isFinite(limit) ? limit : 12 });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "pne_framework_failed" });
  }
});

app.get("/templates/comfy", (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  const category = String(req.query.category || "").trim().toLowerCase();
  const all = listComfyTemplates();
  const filtered = all.filter((item) => {
    if (category && item.category.toLowerCase() !== category) return false;
    if (!q) return true;
    return (
      item.name.toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q) ||
      item.subcategory.toLowerCase().includes(q) ||
      item.workflowRef.toLowerCase().includes(q)
    );
  });
  res.json(filtered);
});

app.post("/templates/comfy/import", (req, res) => {
  const repoPath = req.body?.repoPath ? String(req.body.repoPath) : undefined;
  const sourceRepo = req.body?.sourceRepo ? String(req.body.sourceRepo) : undefined;
  const result = importComfyTemplatesFromRepo(repoPath, sourceRepo);
  res.json({ ...result, total: listComfyTemplates().length });
});

app.get("/workspaces/:workspaceId/snapshot", (req, res) => {
  const hostedBase = resolveHostedApiBase(getDesktopSettings());
  if (hostedBase) {
    void proxyHostedRequest(req, res, hostedBase).catch((error: any) => {
      res.status(502).json({ error: error?.message || "Hosted backend proxy failed" });
    });
    return;
  }
  const workspaceId = req.params.workspaceId || WORKSPACE_DEFAULT;
  res.json(getWorkspace(workspaceId));
});

app.post("/workspaces/:workspaceId/folders/:folderId/products", (req, res) => {
  const hostedBase = resolveHostedApiBase(getDesktopSettings());
  if (hostedBase) {
    void proxyHostedRequest(req, res, hostedBase).catch((error: any) => {
      res.status(502).json({ error: error?.message || "Hosted backend proxy failed" });
    });
    return;
  }
  const workspaceId = req.params.workspaceId || WORKSPACE_DEFAULT;
  const folderId = req.params.folderId;
  const name = String(req.body?.name || "Untitled Product");
  const product = createProduct(workspaceId, folderId, name);
  const event: WorkspaceEvent = {
    type: "product.created",
    workspaceId,
    folderId,
    product,
    updatedAt: nowIso()
  };
  broadcast(workspaceId, event);
  res.status(201).json(product);
});

app.put("/workspaces/:workspaceId/products/:productId/canvas", (req, res) => {
  const hostedBase = resolveHostedApiBase(getDesktopSettings());
  if (hostedBase) {
    void proxyHostedRequest(req, res, hostedBase).catch((error: any) => {
      res.status(502).json({ error: error?.message || "Hosted backend proxy failed" });
    });
    return;
  }
  const workspaceId = req.params.workspaceId || WORKSPACE_DEFAULT;
  const productId = req.params.productId;
  const doc = upsertCanvas(workspaceId, productId, req.body as CanvasDocument);
  const event: WorkspaceEvent = {
    type: "canvas.updated",
    workspaceId,
    productId,
    doc,
    updatedAt: nowIso()
  };
  broadcast(workspaceId, event);
  res.json(doc);
});

app.post("/workspaces/:workspaceId/products/:productId/runs", (req, res) => {
  const hostedBase = resolveHostedApiBase(getDesktopSettings());
  if (hostedBase) {
    void proxyHostedRequest(req, res, hostedBase).catch((error: any) => {
      res.status(502).json({ error: error?.message || "Hosted backend proxy failed" });
    });
    return;
  }
  const workspaceId = req.params.workspaceId || WORKSPACE_DEFAULT;
  const productId = req.params.productId;
  const snapshot = getWorkspace(workspaceId);
  const doc = snapshot.documents[productId];
  if (!doc) {
    res.status(404).json({ error: "Product canvas not found" });
    return;
  }
  const nodeIds = Array.isArray(req.body?.nodeIds)
    ? req.body.nodeIds.filter((value: unknown) => typeof value === "string")
    : undefined;
  const run = createRun(workspaceId, productId);
  runCancellationMap.set(run.id, { cancelled: false });
  void executeRun(workspaceId, productId, run.id, doc, nodeIds);
  res.status(202).json({ runId: run.id, run });
});

app.post("/workspaces/:workspaceId/products/:productId/node-runs", (req, res) => {
  const hostedBase = resolveHostedApiBase(getDesktopSettings());
  if (hostedBase) {
    void proxyHostedRequest(req, res, hostedBase).catch((error: any) => {
      res.status(502).json({ error: error?.message || "Hosted backend proxy failed" });
    });
    return;
  }
  const workspaceId = req.params.workspaceId || WORKSPACE_DEFAULT;
  const productId = req.params.productId;
  const snapshot = getWorkspace(workspaceId);
  const doc = snapshot.documents[productId];
  if (!doc) {
    res.status(404).json({ error: "Product canvas not found" });
    return;
  }
  const nodeIds = Array.isArray(req.body?.nodeIds)
    ? req.body.nodeIds.filter((value: unknown) => typeof value === "string")
    : undefined;
  const run = createRun(workspaceId, productId);
  runCancellationMap.set(run.id, { cancelled: false });
  void executeRun(workspaceId, productId, run.id, doc, nodeIds);
  res.status(202).json({ runId: run.id, run });
});

app.get("/workspaces/:workspaceId/products/:productId/runs", (req, res) => {
  const hostedBase = resolveHostedApiBase(getDesktopSettings());
  if (hostedBase) {
    void proxyHostedRequest(req, res, hostedBase).catch((error: any) => {
      res.status(502).json({ error: error?.message || "Hosted backend proxy failed" });
    });
    return;
  }
  const workspaceId = req.params.workspaceId || WORKSPACE_DEFAULT;
  const productId = req.params.productId;
  res.json(listRuns(workspaceId, productId));
});

app.get("/workspaces/:workspaceId/products/:productId/runs/:runId", (req, res) => {
  const hostedBase = resolveHostedApiBase(getDesktopSettings());
  if (hostedBase) {
    void proxyHostedRequest(req, res, hostedBase).catch((error: any) => {
      res.status(502).json({ error: error?.message || "Hosted backend proxy failed" });
    });
    return;
  }
  const detail = getRunDetail(req.params.runId);
  if (!detail) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  res.json(detail);
});

app.get("/workspaces/:workspaceId/products/:productId/node-runs/:runId", (req, res) => {
  const hostedBase = resolveHostedApiBase(getDesktopSettings());
  if (hostedBase) {
    void proxyHostedRequest(req, res, hostedBase).catch((error: any) => {
      res.status(502).json({ error: error?.message || "Hosted backend proxy failed" });
    });
    return;
  }
  const detail = getRunDetail(req.params.runId);
  if (!detail) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  res.json(detail);
});

app.post("/workspaces/:workspaceId/products/:productId/runs/:runId/cancel", (req, res) => {
  const hostedBase = resolveHostedApiBase(getDesktopSettings());
  if (hostedBase) {
    void proxyHostedRequest(req, res, hostedBase).catch((error: any) => {
      res.status(502).json({ error: error?.message || "Hosted backend proxy failed" });
    });
    return;
  }
  const runId = req.params.runId;
  if (!getRun(runId)) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  const token = runCancellationMap.get(runId);
  if (token) token.cancelled = true;
  const run = updateRunStatus(runId, "cancelled");
  res.json(run);
});

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "", `http://${req.headers.host}`);
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }
  const workspaceId = url.searchParams.get("workspaceId") || WORKSPACE_DEFAULT;
  wss.handleUpgrade(req, socket, head, (ws: any) => {
    ws.workspaceId = workspaceId;
    if (!workspaceSockets.has(workspaceId)) workspaceSockets.set(workspaceId, new Set());
    workspaceSockets.get(workspaceId)!.add(ws);
    ws.on("close", () => workspaceSockets.get(workspaceId)?.delete(ws));
  });
});

server.listen(PORT, () => {
  console.log(`Openflow-desktop local backend listening on http://localhost:${PORT}`);
  console.log(`SQLite DB: ${DB_PATH}`);
});
