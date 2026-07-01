import cors from "cors";
import express from "express";
import { WebSocketServer } from "ws";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { runPersonaNeedEmotion, runPneFramework, runRedditScraper } from "./agentBridge";
import { DATA_STORE_BLUEPRINT_IDS, getBlueprintById, NODE_BLUEPRINTS } from "./blueprints";
import {
  dedupeLocalRedditRunsForResponse,
  deriveLocalRedditRunState,
  shouldReusePreviousLocalRedditRun
} from "./localRedditRuns";

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
  uiState?: Record<string, unknown>;
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

type PromptLibraryRecord = {
  id: string;
  workspaceId: string;
  productId?: string;
  nodeId?: string;
  title: string;
  prompt: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type BrandProfileRunRecord = {
  id: string;
  workspaceId: string;
  nodeId: "brand_kit" | "brand_guidelines";
  runAt: string;
  summary: string;
  countLabel: string;
  sourceLabel: string;
  profileSnapshot: ReturnType<typeof getWorkspaceBrandProfile>;
  meta: Record<string, unknown>;
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
    apifyApiKey: string;
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
    apifyApiKey: "",
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
);
CREATE TABLE IF NOT EXISTS prompt_library_records (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  product_id TEXT,
  node_id TEXT,
  title TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reddit_scrape_runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  product_id TEXT,
  status TEXT NOT NULL,
  run_at TEXT NOT NULL,
  next_run_at TEXT,
  frequency_hours INTEGER NOT NULL,
  findings_json TEXT NOT NULL,
  insights_json TEXT NOT NULL,
  insights_library_json TEXT NOT NULL,
  recurring_subreddits_json TEXT NOT NULL,
  meta_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS node_instruction_memory (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS customer_brain_state (
  workspace_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  selected_insights_json TEXT NOT NULL,
  persona_items_json TEXT NOT NULL,
  pne_combos_json TEXT NOT NULL,
  selection_mode TEXT NOT NULL,
  meta_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id, product_id, node_id)
);
CREATE TABLE IF NOT EXISTS workspace_brand_profiles (
  workspace_id TEXT PRIMARY KEY,
  brand_url TEXT NOT NULL,
  company_name TEXT,
  category TEXT,
  target_audience TEXT,
  products_catalog_json TEXT NOT NULL,
  analysis_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workspace_brand_profile_runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  run_at TEXT NOT NULL,
  summary TEXT NOT NULL,
  count_label TEXT NOT NULL,
  source_label TEXT NOT NULL,
  profile_snapshot_json TEXT NOT NULL,
  meta_json TEXT NOT NULL
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
const insertPromptLibraryStmt = db.prepare(`
  INSERT INTO prompt_library_records (
    id, workspace_id, product_id, node_id, title, prompt_text, metadata_json, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const updatePromptLibraryStmt = db.prepare(`
  UPDATE prompt_library_records
  SET title = ?, prompt_text = ?, metadata_json = ?, product_id = ?, node_id = ?, updated_at = ?
  WHERE id = ? AND workspace_id = ?
`);
const deletePromptLibraryStmt = db.prepare(`
  DELETE FROM prompt_library_records
  WHERE id = ? AND workspace_id = ?
`);
const readPromptLibraryStmt = db.prepare(`
  SELECT
    id,
    workspace_id as workspaceId,
    product_id as productId,
    node_id as nodeId,
    title,
    prompt_text as prompt,
    metadata_json as metadataJson,
    created_at as createdAt,
    updated_at as updatedAt
  FROM prompt_library_records
  WHERE id = ? AND workspace_id = ?
  LIMIT 1
`);
const readPromptLibraryByWorkspaceStmt = db.prepare(`
  SELECT
    id,
    workspace_id as workspaceId,
    product_id as productId,
    node_id as nodeId,
    title,
    prompt_text as prompt,
    metadata_json as metadataJson,
    created_at as createdAt,
    updated_at as updatedAt
  FROM prompt_library_records
  WHERE workspace_id = ?
  ORDER BY updated_at DESC
  LIMIT ?
`);
const insertRedditScrapeRunStmt = db.prepare(`
  INSERT INTO reddit_scrape_runs (
    id, workspace_id, node_id, product_id, status, run_at, next_run_at, frequency_hours,
    findings_json, insights_json, insights_library_json, recurring_subreddits_json, meta_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const readRedditRunsStmt = db.prepare(`
  SELECT
    id,
    workspace_id as workspaceId,
    node_id as nodeId,
    product_id as productId,
    status,
    run_at as runAt,
    next_run_at as nextRunAt,
    frequency_hours as frequencyHours,
    findings_json as findingsJson,
    insights_json as insightsJson,
    insights_library_json as insightsLibraryJson,
    recurring_subreddits_json as recurringSubredditsJson,
    meta_json as metaJson
  FROM reddit_scrape_runs
  WHERE workspace_id = ? AND (? IS NULL OR node_id = ?)
  ORDER BY run_at DESC
  LIMIT ?
`);
const readRedditRunByIdStmt = db.prepare(`
  SELECT
    id,
    workspace_id as workspaceId,
    node_id as nodeId,
    product_id as productId,
    status,
    run_at as runAt,
    next_run_at as nextRunAt,
    frequency_hours as frequencyHours,
    findings_json as findingsJson,
    insights_json as insightsJson,
    insights_library_json as insightsLibraryJson,
    recurring_subreddits_json as recurringSubredditsJson,
    meta_json as metaJson
  FROM reddit_scrape_runs
  WHERE workspace_id = ? AND id = ?
  LIMIT 1
`);
const readLatestRedditRunStmt = db.prepare(`
  SELECT
    id,
    workspace_id as workspaceId,
    node_id as nodeId,
    product_id as productId,
    status,
    run_at as runAt,
    next_run_at as nextRunAt,
    frequency_hours as frequencyHours,
    findings_json as findingsJson,
    insights_json as insightsJson,
    insights_library_json as insightsLibraryJson,
    recurring_subreddits_json as recurringSubredditsJson,
    meta_json as metaJson
  FROM reddit_scrape_runs
  WHERE workspace_id = ? AND node_id = ?
  ORDER BY run_at DESC
  LIMIT 1
`);
const insertNodeInstructionStmt = db.prepare(`
  INSERT INTO node_instruction_memory (id, workspace_id, node_id, text, created_at)
  VALUES (?, ?, ?, ?, ?)
`);
const readNodeInstructionsStmt = db.prepare(`
  SELECT
    id,
    workspace_id as workspaceId,
    node_id as nodeId,
    text,
    created_at as createdAt
  FROM node_instruction_memory
  WHERE workspace_id = ? AND node_id = ?
  ORDER BY created_at DESC
  LIMIT ?
`);
const upsertCustomerBrainStateStmt = db.prepare(`
  INSERT INTO customer_brain_state (
    workspace_id, product_id, node_id, selected_insights_json, persona_items_json, pne_combos_json,
    selection_mode, meta_json, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(workspace_id, product_id, node_id) DO UPDATE SET
    selected_insights_json = excluded.selected_insights_json,
    persona_items_json = excluded.persona_items_json,
    pne_combos_json = excluded.pne_combos_json,
    selection_mode = excluded.selection_mode,
    meta_json = excluded.meta_json,
    updated_at = excluded.updated_at
`);
const readCustomerBrainStateStmt = db.prepare(`
  SELECT
    workspace_id as workspaceId,
    product_id as productId,
    node_id as nodeId,
    selected_insights_json as selectedInsightsJson,
    persona_items_json as personaItemsJson,
    pne_combos_json as pneCombosJson,
    selection_mode as selectionMode,
    meta_json as metaJson,
    updated_at as updatedAt
  FROM customer_brain_state
  WHERE workspace_id = ? AND product_id = ? AND node_id = ?
  LIMIT 1
`);
const upsertWorkspaceBrandProfileStmt = db.prepare(`
  INSERT INTO workspace_brand_profiles (
    workspace_id, brand_url, company_name, category, target_audience, products_catalog_json, analysis_json, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(workspace_id) DO UPDATE SET
    brand_url = excluded.brand_url,
    company_name = excluded.company_name,
    category = excluded.category,
    target_audience = excluded.target_audience,
    products_catalog_json = excluded.products_catalog_json,
    analysis_json = excluded.analysis_json,
    updated_at = excluded.updated_at
`);
const readWorkspaceBrandProfileStmt = db.prepare(`
  SELECT
    workspace_id as workspaceId,
    brand_url as brandUrl,
    company_name as companyName,
    category,
    target_audience as targetAudience,
    products_catalog_json as productsCatalogJson,
    analysis_json as analysisJson,
    updated_at as updatedAt
  FROM workspace_brand_profiles
  WHERE workspace_id = ?
  LIMIT 1
`);
const insertBrandProfileRunStmt = db.prepare(`
  INSERT INTO workspace_brand_profile_runs (
    id, workspace_id, node_id, run_at, summary, count_label, source_label, profile_snapshot_json, meta_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const readRecentBrandProfileRunsStmt = db.prepare(`
  SELECT
    id,
    workspace_id as workspaceId,
    node_id as nodeId,
    run_at as runAt,
    summary,
    count_label as countLabel,
    source_label as sourceLabel,
    profile_snapshot_json as profileSnapshotJson,
    meta_json as metaJson
  FROM workspace_brand_profile_runs
  WHERE workspace_id = ?
    AND (? IS NULL OR node_id = ?)
  ORDER BY datetime(run_at) DESC, id DESC
  LIMIT ?
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

function parsePromptLibraryRow(row: {
  id: string;
  workspaceId: string;
  productId: string | null;
  nodeId: string | null;
  title: string;
  prompt: string;
  metadataJson: string;
  createdAt: string;
  updatedAt: string;
}): PromptLibraryRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    productId: row.productId || undefined,
    nodeId: row.nodeId || undefined,
    title: row.title,
    prompt: row.prompt,
    metadata: (() => {
      try {
        const parsed = JSON.parse(row.metadataJson || "{}");
        return parsed && typeof parsed === "object" ? parsed : {};
      } catch {
        return {};
      }
    })(),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function createPromptLibraryRecord(
  workspaceId: string,
  input: { productId?: string; nodeId?: string; title: string; prompt: string; metadata?: Record<string, unknown> }
): PromptLibraryRecord {
  const now = nowIso();
  const id = newId("pr");
  insertPromptLibraryStmt.run(
    id,
    workspaceId,
    input.productId || null,
    input.nodeId || null,
    input.title,
    input.prompt,
    JSON.stringify(input.metadata || {}),
    now,
    now
  );
  const row = readPromptLibraryStmt.get(id, workspaceId) as
    | {
        id: string;
        workspaceId: string;
        productId: string | null;
        nodeId: string | null;
        title: string;
        prompt: string;
        metadataJson: string;
        createdAt: string;
        updatedAt: string;
      }
    | undefined;
  if (!row) {
    throw new Error("Failed to persist prompt record");
  }
  return parsePromptLibraryRow(row);
}

function updatePromptLibraryRecord(
  workspaceId: string,
  promptId: string,
  input: { productId?: string; nodeId?: string; title: string; prompt: string; metadata?: Record<string, unknown> }
): PromptLibraryRecord | null {
  updatePromptLibraryStmt.run(
    input.title,
    input.prompt,
    JSON.stringify(input.metadata || {}),
    input.productId || null,
    input.nodeId || null,
    nowIso(),
    promptId,
    workspaceId
  );
  const row = readPromptLibraryStmt.get(promptId, workspaceId) as
    | {
        id: string;
        workspaceId: string;
        productId: string | null;
        nodeId: string | null;
        title: string;
        prompt: string;
        metadataJson: string;
        createdAt: string;
        updatedAt: string;
      }
    | undefined;
  return row ? parsePromptLibraryRow(row) : null;
}

function deletePromptLibraryRecord(workspaceId: string, promptId: string) {
  const before = readPromptLibraryStmt.get(promptId, workspaceId) as
    | {
        id: string;
        workspaceId: string;
        productId: string | null;
        nodeId: string | null;
        title: string;
        prompt: string;
        metadataJson: string;
        createdAt: string;
        updatedAt: string;
      }
    | undefined;
  if (!before) return false;
  deletePromptLibraryStmt.run(promptId, workspaceId);
  return true;
}

function listPromptLibraryRecords(
  workspaceId: string,
  opts?: { productId?: string; nodeId?: string; q?: string; limit?: number }
): PromptLibraryRecord[] {
  const limit = Math.max(1, Math.min(500, Math.floor(Number(opts?.limit || 100))));
  const rows = readPromptLibraryByWorkspaceStmt.all(workspaceId, limit) as Array<{
    id: string;
    workspaceId: string;
    productId: string | null;
    nodeId: string | null;
    title: string;
    prompt: string;
    metadataJson: string;
    createdAt: string;
    updatedAt: string;
  }>;
  const q = String(opts?.q || "").trim().toLowerCase();
  const productId = String(opts?.productId || "").trim();
  const nodeId = String(opts?.nodeId || "").trim();
  return rows
    .map(parsePromptLibraryRow)
    .filter((item) => (!productId || item.productId === productId))
    .filter((item) => (!nodeId || item.nodeId === nodeId))
    .filter((item) => {
      if (!q) return true;
      return `${item.title} ${item.prompt}`.toLowerCase().includes(q);
    });
}

function parseJsonArray(value: string) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: string) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeValue(existingValue: unknown, incomingValue: unknown): unknown {
  if (Array.isArray(incomingValue)) {
    if (incomingValue.length > 0) return incomingValue;
    return Array.isArray(existingValue) ? existingValue : incomingValue;
  }
  if (isPlainObject(existingValue) && isPlainObject(incomingValue)) {
    return mergeBrandAnalysisJson(existingValue, incomingValue);
  }
  return incomingValue === undefined ? existingValue : incomingValue;
}

function mergeBrandAnalysisJson(
  existing: Record<string, unknown> | undefined,
  incoming: Record<string, unknown> | undefined,
  extra: Record<string, unknown> = {}
) {
  const base = isPlainObject(existing) ? existing : {};
  const next = isPlainObject(incoming) ? incoming : {};
  const merged: Record<string, unknown> = { ...base };
  Object.keys(next).forEach((key) => {
    merged[key] = mergeValue(base[key], next[key]);
  });
  Object.keys(extra).forEach((key) => {
    merged[key] = extra[key];
  });
  return merged;
}

function parseRedditRunRow(row: {
  id: string;
  workspaceId: string;
  nodeId: string;
  productId: string | null;
  status: string;
  runAt: string;
  nextRunAt: string | null;
  frequencyHours: number;
  findingsJson: string;
  insightsJson: string;
  insightsLibraryJson: string;
  recurringSubredditsJson: string;
  metaJson: string;
}) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    nodeId: row.nodeId,
    productId: row.productId || undefined,
    status: row.status,
    runAt: row.runAt,
    nextRunAt: row.nextRunAt || undefined,
    frequencyHours: Number(row.frequencyHours || 24),
    findings: parseJsonArray(row.findingsJson),
    insights: parseJsonArray(row.insightsJson),
    insightsLibrary: parseJsonArray(row.insightsLibraryJson),
    recurringSubreddits: parseJsonArray(row.recurringSubredditsJson),
    meta: parseJsonObject(row.metaJson)
  };
}

function persistRedditScrapeRun(input: {
  workspaceId: string;
  nodeId: string;
  productId?: string;
  status: "completed" | "failed";
  runAt: string;
  nextRunAt?: string;
  frequencyHours: number;
  findings: Array<Record<string, unknown>>;
  insights: Array<Record<string, unknown>>;
  insightsLibrary: Array<Record<string, unknown>>;
  recurringSubreddits: Array<Record<string, unknown>>;
  meta: Record<string, unknown>;
}) {
  const previous = listRedditScrapeRuns(input.workspaceId, input.nodeId, 1)[0];
  if (
    shouldReusePreviousLocalRedditRun(previous, {
      nodeId: input.nodeId,
      status: input.status,
      findings: input.findings,
      insights: input.insights,
      meta: input.meta
    })
  ) {
    return previous;
  }
  const id = newId("rr");
  insertRedditScrapeRunStmt.run(
    id,
    input.workspaceId,
    input.nodeId,
    input.productId || null,
    input.status,
    input.runAt,
    input.nextRunAt || null,
    Math.max(1, Number(input.frequencyHours || 24)),
    JSON.stringify(input.findings || []),
    JSON.stringify(input.insights || []),
    JSON.stringify(input.insightsLibrary || []),
    JSON.stringify(input.recurringSubreddits || []),
    JSON.stringify(input.meta || {})
  );
  const row = readRedditRunByIdStmt.get(input.workspaceId, id) as
    | {
        id: string;
        workspaceId: string;
        nodeId: string;
        productId: string | null;
        status: string;
        runAt: string;
        nextRunAt: string | null;
        frequencyHours: number;
        findingsJson: string;
        insightsJson: string;
        insightsLibraryJson: string;
        recurringSubredditsJson: string;
        metaJson: string;
      }
    | undefined;
  if (!row) throw new Error("Failed to persist Reddit scrape run");
  return parseRedditRunRow(row);
}

function listRedditScrapeRuns(workspaceId: string, nodeId?: string, limit = 20) {
  const rows = readRedditRunsStmt.all(
    workspaceId,
    nodeId || null,
    nodeId || null,
    Math.max(1, Math.min(200, Math.floor(limit)))
  ) as Array<{
    id: string;
    workspaceId: string;
    nodeId: string;
    productId: string | null;
    status: string;
    runAt: string;
    nextRunAt: string | null;
    frequencyHours: number;
    findingsJson: string;
    insightsJson: string;
    insightsLibraryJson: string;
    recurringSubredditsJson: string;
    metaJson: string;
  }>;
  return rows.map(parseRedditRunRow);
}

function getRedditScrapeRunById(workspaceId: string, runId: string) {
  const row = readRedditRunByIdStmt.get(workspaceId, runId) as
    | {
        id: string;
        workspaceId: string;
        nodeId: string;
        productId: string | null;
        status: string;
        runAt: string;
        nextRunAt: string | null;
        frequencyHours: number;
        findingsJson: string;
        insightsJson: string;
        insightsLibraryJson: string;
        recurringSubredditsJson: string;
        metaJson: string;
      }
    | undefined;
  return row ? parseRedditRunRow(row) : null;
}

function listNodeInstructionMemory(workspaceId: string, nodeId: string, limit = 50) {
  const rows = readNodeInstructionsStmt.all(workspaceId, nodeId, Math.max(1, Math.min(200, Math.floor(limit)))) as Array<{
    id: string;
    workspaceId: string;
    nodeId: string;
    text: string;
    createdAt: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspaceId,
    nodeId: row.nodeId,
    text: row.text,
    createdAt: row.createdAt
  }));
}

function createNodeInstructionMemory(input: { workspaceId: string; nodeId: string; text: string; createdAt?: string }) {
  const row = {
    id: newId("instr"),
    workspaceId: input.workspaceId,
    nodeId: input.nodeId,
    text: String(input.text || "").trim(),
    createdAt: String(input.createdAt || nowIso())
  };
  insertNodeInstructionStmt.run(row.id, row.workspaceId, row.nodeId, row.text, row.createdAt);
  return row;
}

function getCustomerBrainState(workspaceId: string, productId: string, nodeId = "customer") {
  const row = readCustomerBrainStateStmt.get(workspaceId, productId, nodeId) as
    | {
        workspaceId: string;
        productId: string;
        nodeId: string;
        selectedInsightsJson: string;
        personaItemsJson: string;
        pneCombosJson: string;
        selectionMode: string;
        metaJson: string;
        updatedAt: string;
      }
    | undefined;
  if (!row) {
    return {
      workspaceId,
      productId,
      nodeId,
      selectedInsights: [],
      personaItems: [],
      pneCombos: [],
      selectionMode: "none",
      meta: {},
      updatedAt: nowIso()
    };
  }
  return {
    workspaceId: row.workspaceId,
    productId: row.productId,
    nodeId: row.nodeId,
    selectedInsights: parseJsonArray(row.selectedInsightsJson),
    personaItems: parseJsonArray(row.personaItemsJson),
    pneCombos: parseJsonArray(row.pneCombosJson),
    selectionMode: String(row.selectionMode || "none"),
    meta: parseJsonObject(row.metaJson),
    updatedAt: row.updatedAt
  };
}

function deriveActivePneIdFromRows(rows: Array<Record<string, unknown>>, preferredId?: string | null) {
  const normalizedRows = Array.isArray(rows) ? rows : [];
  const wanted = String(preferredId || "").trim();
  if (wanted && normalizedRows.some((item) => String(item.id || "").trim() === wanted)) return wanted;
  const flagged = normalizedRows.find((item) => Boolean(item.isPrimary) && String(item.id || "").trim());
  if (flagged) return String(flagged.id || "").trim();
  const first = normalizedRows[0];
  return String((first && first.id) || "").trim();
}

function withNormalizedPrimaryPneRows(rows: Array<Record<string, unknown>>, preferredId?: string | null) {
  const normalizedRows = (Array.isArray(rows) ? rows : [])
    .filter((item) => item && typeof item === "object")
    .map((item) => ({ ...item }));
  const activePneId = deriveActivePneIdFromRows(normalizedRows, preferredId);
  return normalizedRows.map((item, idx) => ({
    ...item,
    isPrimary: activePneId ? String(item.id || "").trim() === activePneId : idx === 0
  }));
}

function parseWorkspaceBrandProfileRow(row: {
  workspaceId: string;
  brandUrl: string;
  companyName: string | null;
  category: string | null;
  targetAudience: string | null;
  productsCatalogJson: string;
  analysisJson: string;
  updatedAt: string;
}) {
  return {
    workspaceId: row.workspaceId,
    brandUrl: row.brandUrl,
    companyName: row.companyName || "",
    category: row.category || "",
    targetAudience: row.targetAudience || "",
    productsCatalog: parseJsonArray(row.productsCatalogJson).map((entry) => String(entry || "")).filter(Boolean),
    analysisJson: parseJsonObject(row.analysisJson),
    updatedAt: row.updatedAt
  };
}

function getWorkspaceBrandProfile(workspaceId: string) {
  const row = readWorkspaceBrandProfileStmt.get(workspaceId) as
    | {
        workspaceId: string;
        brandUrl: string;
        companyName: string | null;
        category: string | null;
        targetAudience: string | null;
        productsCatalogJson: string;
        analysisJson: string;
        updatedAt: string;
      }
    | undefined;
  return row ? parseWorkspaceBrandProfileRow(row) : null;
}

function upsertWorkspaceBrandProfile(
  workspaceId: string,
  input: {
    brandUrl: string;
    companyName?: string;
    category?: string;
    targetAudience?: string;
    productsCatalog?: string[];
    analysisJson?: Record<string, unknown>;
  }
) {
  const normalized = {
    workspaceId,
    brandUrl: normalizeBrandUrl(input.brandUrl),
    companyName: String(input.companyName || "").trim(),
    category: String(input.category || "").trim(),
    targetAudience: String(input.targetAudience || "").trim(),
    productsCatalog: Array.isArray(input.productsCatalog)
      ? Array.from(new Set(input.productsCatalog.map((value) => String(value || "").trim()).filter(Boolean))).slice(0, 24)
      : [],
    analysisJson: isPlainObject(input.analysisJson) ? input.analysisJson : {},
    updatedAt: nowIso()
  };
  upsertWorkspaceBrandProfileStmt.run(
    normalized.workspaceId,
    normalized.brandUrl,
    normalized.companyName || null,
    normalized.category || null,
    normalized.targetAudience || null,
    JSON.stringify(normalized.productsCatalog),
    JSON.stringify(normalized.analysisJson),
    normalized.updatedAt
  );
  return getWorkspaceBrandProfile(workspaceId);
}

function toBrandProfileRunRecord(
  row:
    | {
        id: string;
        workspaceId: string;
        nodeId: "brand_kit" | "brand_guidelines";
        runAt: string;
        summary: string;
        countLabel: string;
        sourceLabel: string;
        profileSnapshotJson: string;
        metaJson: string;
      }
    | undefined
) {
  if (!row) return null;
  const profileSnapshot = parseJsonObject(row.profileSnapshotJson);
  if (!profileSnapshot || typeof profileSnapshot !== "object" || !profileSnapshot.brandUrl) return null;
  const meta = parseJsonObject(row.metaJson);
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    nodeId: row.nodeId,
    runAt: row.runAt,
    summary: row.summary,
    countLabel: row.countLabel,
    sourceLabel: row.sourceLabel,
    profileSnapshot,
    meta
  };
}

function createBrandProfileRun(input: {
  workspaceId: string;
  nodeId: "brand_kit" | "brand_guidelines";
  runAt?: string;
  summary: string;
  countLabel: string;
  sourceLabel: string;
  profileSnapshot: ReturnType<typeof getWorkspaceBrandProfile>;
  meta?: Record<string, unknown>;
}) {
  const record = {
    id: newId("bpr"),
    workspaceId: String(input.workspaceId || "").trim(),
    nodeId: input.nodeId,
    runAt: String(input.runAt || nowIso()).trim() || nowIso(),
    summary: String(input.summary || "").trim(),
    countLabel: String(input.countLabel || "").trim(),
    sourceLabel: String(input.sourceLabel || "").trim(),
    profileSnapshot: input.profileSnapshot,
    meta: isPlainObject(input.meta) ? input.meta : {}
  };
  insertBrandProfileRunStmt.run(
    record.id,
    record.workspaceId,
    record.nodeId,
    record.runAt,
    record.summary,
    record.countLabel,
    record.sourceLabel,
    JSON.stringify(record.profileSnapshot || {}),
    JSON.stringify(record.meta)
  );
  return record;
}

function listBrandProfileRuns(workspaceId: string, nodeId?: "brand_kit" | "brand_guidelines", limit = 20) {
  const rows = readRecentBrandProfileRunsStmt.all(
    workspaceId,
    nodeId || null,
    nodeId || null,
    Math.max(1, Math.min(200, Math.floor(limit)))
  ) as Array<{
    id: string;
    workspaceId: string;
    nodeId: "brand_kit" | "brand_guidelines";
    runAt: string;
    summary: string;
    countLabel: string;
    sourceLabel: string;
    profileSnapshotJson: string;
    metaJson: string;
  }>;
  return rows
    .map((row) => toBrandProfileRunRecord(row))
    .filter(Boolean);
}

function normalizeBrandUrl(value: string) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return candidate.replace(/\/+$/, "");
  }
}

function inferCompanyNameFromUrl(brandUrl: string) {
  const normalized = normalizeBrandUrl(brandUrl);
  if (!normalized) return "Openflow Brand";
  try {
    const host = new URL(normalized).hostname.replace(/^www\./i, "");
    const domain = host.split(".")[0] || "brand";
    return domain
      .split(/[-_]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  } catch {
    return "Openflow Brand";
  }
}

function inferCategoryFromSignals(text: string, fallback = "general") {
  const lc = String(text || "").toLowerCase();
  if (/(athleisure|activewear|leggings|workout|gym wear|sports bra|sport|fitness apparel)/.test(lc)) return "athleisure";
  if (/(beauty|skincare|serum|moisturizer|cosmetic|cleanser)/.test(lc)) return "beauty";
  if (/(sleep|baby|kids|children|pajamas|crib)/.test(lc)) return "kids lifestyle";
  if (/(supplement|vitamin|wellness|protein|nutrition)/.test(lc)) return "wellness";
  return String(fallback || "general").trim() || "general";
}

function inferTargetAudience(category: string, signalText: string, fallback = "") {
  const lc = `${category} ${signalText}`.toLowerCase();
  if (/(women|female|moms|mother)/.test(lc) && /(activewear|athleisure|fitness)/.test(lc)) {
    return "Women looking for comfortable, flattering performance wear";
  }
  if (/(baby|kids|children|parents|toddlers)/.test(lc)) {
    return "Parents shopping for children and family essentials";
  }
  if (/(beauty|skincare)/.test(lc)) {
    return "Routine-conscious shoppers comparing efficacy, comfort, and trust";
  }
  return String(fallback || "").trim() || "High-intent online shoppers";
}

function extractTagText(html: string, tag: string, limit = 4) {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  const values: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) && values.length < limit) {
    const text = String(match[1] || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) values.push(text);
  }
  return values;
}

function extractMetaContent(html: string, names: string[]) {
  for (const name of names) {
    const regex = new RegExp(
      `<meta[^>]+(?:name|property)=["']${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]+content=["']([^"']+)["'][^>]*>`,
      "i"
    );
    const match = html.match(regex);
    if (match?.[1]) return String(match[1]).trim();
  }
  return "";
}

function uniqStrings(values: unknown[], limit = 6) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean))).slice(0, limit);
}

async function analyzeBrandProfile(brandUrl: string) {
  const normalizedUrl = normalizeBrandUrl(brandUrl);
  const fallbackCompany = inferCompanyNameFromUrl(normalizedUrl);
  const baseResult = {
    brandUrl: normalizedUrl,
    companyName: fallbackCompany,
    category: inferCategoryFromSignals(normalizedUrl, "general"),
    targetAudience: "High-intent online shoppers",
    productsCatalog: [] as string[],
    analysisJson: {
      source: "local_url_inference",
      analyzedAt: nowIso(),
      siteMeta: {
        title: "",
        description: "",
        heroHeadlines: [] as string[],
        secondaryHeadlines: [] as string[]
      },
      brandKit: {
        colorPalette: [] as string[],
        assetCandidates: [] as string[],
        valueProps: [] as string[],
        visualSignals: [] as string[]
      },
      brandGuidelines: {
        toneTraits: [] as string[],
        messagingPillars: [] as string[],
        proofPoints: [] as string[],
        ctaStyles: [] as string[],
        positioningSummary: `${fallbackCompany} positioning will be refined after website analysis.`
      }
    }
  };
  if (!normalizedUrl) return baseResult;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(normalizedUrl, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "OpenflowDesktop/1.0 (+local-brand-analysis)" }
    });
    if (!res.ok) return baseResult;
    const html = await res.text();
    const title = extractTagText(html, "title", 1)[0] || "";
    const description = extractMetaContent(html, ["description", "og:description", "twitter:description"]);
    const siteName = extractMetaContent(html, ["og:site_name", "application-name"]);
    const h1s = extractTagText(html, "h1", 4);
    const h2s = extractTagText(html, "h2", 6);
    const visibleSignal = `${normalizedUrl} ${title} ${description} ${siteName} ${h1s.join(" ")} ${h2s.join(" ")}`;
    const category = inferCategoryFromSignals(visibleSignal, baseResult.category);
    const companyName = siteName || title.split(/[|\-–—]/)[0]?.trim() || fallbackCompany;
    const targetAudience = inferTargetAudience(category, visibleSignal, baseResult.targetAudience);
    const productsCatalog = uniqStrings([...h1s, ...h2s], 6);
    return {
      brandUrl: normalizedUrl,
      companyName,
      category,
      targetAudience,
      productsCatalog,
      analysisJson: {
        source: "local_website_fetch",
        analyzedAt: nowIso(),
        siteMeta: {
          title,
          description,
          heroHeadlines: h1s,
          secondaryHeadlines: h2s
        },
        brandKit: {
          colorPalette: [],
          assetCandidates: [],
          valueProps: uniqStrings([description, ...h1s, ...h2s], 5),
          visualSignals: uniqStrings([
            category === "athleisure" ? "Movement and fit-focused merchandising" : "",
            /collection|drop|shop/i.test(visibleSignal) ? "Collection-led shopping journey" : "",
            /video|watch/i.test(visibleSignal) ? "Video-forward merchandising cues" : ""
          ], 4)
        },
        brandGuidelines: {
          toneTraits: uniqStrings([
            /premium|luxury/i.test(visibleSignal) ? "premium" : "",
            /comfort|soft/i.test(visibleSignal) ? "comfort-led" : "",
            /performance|technical/i.test(visibleSignal) ? "performance-led" : "",
            /community|story/i.test(visibleSignal) ? "community-aware" : ""
          ], 4),
          messagingPillars: uniqStrings([
            description,
            h1s[0],
            category === "athleisure" ? "Performance and comfort without compromise" : ""
          ], 4),
          proofPoints: uniqStrings([
            /review|testimonial/i.test(visibleSignal) ? "Review and social proof language appears on site" : "",
            /best seller|bestseller/i.test(visibleSignal) ? "Hero or bestseller merchandising appears on site" : ""
          ], 4),
          ctaStyles: uniqStrings([
            /shop now/i.test(visibleSignal) ? "Shop now" : "",
            /learn more/i.test(visibleSignal) ? "Learn more" : "",
            /explore/i.test(visibleSignal) ? "Explore collection" : ""
          ], 4),
          positioningSummary: description || `${companyName} focuses on ${category} offers for ${targetAudience}.`
        }
      }
    };
  } catch {
    return baseResult;
  } finally {
    clearTimeout(timeout);
  }
}

function brandProfileList(values: unknown, limit: number) {
  if (!Array.isArray(values)) return [];
  return values.map((value) => String(value || "").trim()).filter(Boolean).slice(0, Math.max(0, limit));
}

function summarizeBrandKitProfile(profile: ReturnType<typeof getWorkspaceBrandProfile>, sourceLabel?: string) {
  const analysis = isPlainObject(profile?.analysisJson) ? profile.analysisJson : {};
  const brandKit = isPlainObject((analysis as Record<string, unknown>).brandKit)
    ? ((analysis as Record<string, unknown>).brandKit as Record<string, unknown>)
    : {};
  const valueProps = brandProfileList(brandKit.valueProps, 8);
  const colors = brandProfileList(brandKit.colorPalette, 8);
  const products = brandProfileList(profile?.productsCatalog, 8);
  const assetCandidates = Array.isArray(brandKit.assetCandidates) ? brandKit.assetCandidates : [];
  const prefix = /starter|bootstrap|onboarding|preserved/i.test(String(sourceLabel || ""))
    ? "Starter brand kit ready"
    : "Brand kit loaded";
  const parts = [
    valueProps.length ? `${valueProps.length} value prop${valueProps.length === 1 ? "" : "s"}` : "",
    products.length ? `${products.length} product cue${products.length === 1 ? "" : "s"}` : "",
    assetCandidates.length ? `${assetCandidates.length} asset candidate${assetCandidates.length === 1 ? "" : "s"}` : "",
    colors.length ? `${colors.length} color cue${colors.length === 1 ? "" : "s"}` : ""
  ].filter(Boolean);
  return `${prefix}${parts.length ? ` · ${parts.slice(0, 3).join(" · ")}` : ""}`;
}

function summarizeBrandGuidelinesProfile(profile: ReturnType<typeof getWorkspaceBrandProfile>, sourceLabel?: string) {
  const analysis = isPlainObject(profile?.analysisJson) ? profile.analysisJson : {};
  const guidelines = isPlainObject((analysis as Record<string, unknown>).brandGuidelines)
    ? ((analysis as Record<string, unknown>).brandGuidelines as Record<string, unknown>)
    : {};
  const toneTraits = brandProfileList(guidelines.toneTraits, 8);
  const pillars = brandProfileList(guidelines.messagingPillars, 8);
  const proofPoints = brandProfileList(guidelines.proofPoints, 8);
  const prefix = /starter|bootstrap|onboarding|preserved/i.test(String(sourceLabel || ""))
    ? "Starter guidelines ready"
    : "Messaging system mapped";
  const parts = [
    pillars.length ? `${pillars.length} pillar${pillars.length === 1 ? "" : "s"}` : "",
    toneTraits.length ? `${toneTraits.length} tone trait${toneTraits.length === 1 ? "" : "s"}` : "",
    proofPoints.length ? `${proofPoints.length} proof cue${proofPoints.length === 1 ? "" : "s"}` : ""
  ].filter(Boolean);
  return `${prefix}${parts.length ? ` · ${parts.slice(0, 3).join(" · ")}` : ""}`;
}

function brandProfileCountLabel(profile: ReturnType<typeof getWorkspaceBrandProfile>, nodeId: "brand_kit" | "brand_guidelines") {
  const analysis = isPlainObject(profile?.analysisJson) ? profile.analysisJson : {};
  if (nodeId === "brand_guidelines") {
    const guidelines = isPlainObject((analysis as Record<string, unknown>).brandGuidelines)
      ? ((analysis as Record<string, unknown>).brandGuidelines as Record<string, unknown>)
      : {};
    const pillars = brandProfileList(guidelines.messagingPillars, 8);
    const tones = brandProfileList(guidelines.toneTraits, 8);
    const proofs = brandProfileList(guidelines.proofPoints, 8);
    return `${Math.max(pillars.length, tones.length, proofs.length, 1)} signals`;
  }
  const brandKit = isPlainObject((analysis as Record<string, unknown>).brandKit)
    ? ((analysis as Record<string, unknown>).brandKit as Record<string, unknown>)
    : {};
  const valueProps = brandProfileList(brandKit.valueProps, 8);
  const colors = brandProfileList(brandKit.colorPalette, 8);
  const products = brandProfileList(profile?.productsCatalog, 8);
  const assets = Array.isArray(brandKit.assetCandidates) ? brandKit.assetCandidates : [];
  return `${Math.max(valueProps.length, colors.length, products.length, assets.length, 1)} signals`;
}

function persistBrandProfileRuns(
  workspaceId: string,
  profile: ReturnType<typeof getWorkspaceBrandProfile>,
  sourceLabel: string,
  meta?: Record<string, unknown>
) {
  if (!profile || !profile.brandUrl) return [];
  return ([
    { nodeId: "brand_kit" as const, summary: summarizeBrandKitProfile(profile, sourceLabel) },
    { nodeId: "brand_guidelines" as const, summary: summarizeBrandGuidelinesProfile(profile, sourceLabel) }
  ]).map((item) =>
    createBrandProfileRun({
      workspaceId,
      nodeId: item.nodeId,
      runAt: profile.updatedAt || nowIso(),
      summary: item.summary,
      countLabel: brandProfileCountLabel(profile, item.nodeId),
      sourceLabel,
      profileSnapshot: profile,
      meta
    })
  );
}

function takeScopedRecentRecords(
  records: Array<{ payload: Record<string, unknown>; ingestedAt: string } & Record<string, unknown>>,
  limit: number,
  productId?: string
) {
  const scoped = productId
    ? records.filter((record) => String((record.payload && record.payload.productId) || "").trim() === String(productId).trim())
    : records;
  return scoped.slice(0, Math.max(1, limit));
}

function buildCustomerBrainPneState(workspaceId: string, productId?: string) {
  const state = getCustomerBrainState(workspaceId, productId || "p-motion-canvas", "customer");
  const normalizedPneCombos = withNormalizedPrimaryPneRows(
    Array.isArray(state.pneCombos) ? (state.pneCombos as Array<Record<string, unknown>>) : [],
    String((state.meta && (state.meta as Record<string, unknown>).activePneId) || "").trim()
  );
  const activePneId = deriveActivePneIdFromRows(
    normalizedPneCombos,
    String((state.meta && (state.meta as Record<string, unknown>).activePneId) || "").trim()
  );
  return {
    selectedInsights: state.selectedInsights,
    personaItems: state.personaItems,
    pneCombos: normalizedPneCombos,
    selectionMode: state.selectionMode,
    meta: { ...(state.meta || {}), activePneId },
    updatedAt: state.updatedAt
  };
}

function listBriefLibraryRecords(workspaceId: string, limit = 12, productId?: string) {
  return takeScopedRecentRecords(listRecentDataStoreRecords("db_briefs_library", workspaceId, limit * 4), limit, productId).map((record) => ({
    recordId: record.id,
    sourceNodeId: record.sourceNodeId,
    runId: record.runId,
    ingestedAt: record.ingestedAt,
    ...((record.payload && typeof record.payload === "object" ? record.payload : {}) as Record<string, unknown>)
  }));
}

function listStoryboardLibraryRecords(workspaceId: string, limit = 12, productId?: string) {
  return takeScopedRecentRecords(listRecentDataStoreRecords("db_storyboard_library", workspaceId, limit * 4), limit, productId).map((record) => ({
    recordId: record.id,
    sourceNodeId: record.sourceNodeId,
    runId: record.runId,
    ingestedAt: record.ingestedAt,
    ...((record.payload && typeof record.payload === "object" ? record.payload : {}) as Record<string, unknown>)
  }));
}

function presentationRevisionTimestampValue(record: Record<string, unknown>): number {
  const stamp = String(record.updatedAt || record.ingestedAt || record.createdAt || "").trim();
  const millis = stamp ? Date.parse(stamp) : Number.NaN;
  return Number.isFinite(millis) ? millis : 0;
}

function presentationRevisionVersionValue(record: Record<string, unknown>): number {
  return Number(record.version || 0) || 0;
}

function matchesPresentationRevisionCandidate(
  record: Record<string, unknown>,
  incomingId: string,
  incomingCode: string,
  incomingRootId: string
) {
  const recordId = String(record.id || record.recordId || "").trim();
  const recordRootId = String(record.rootId || "").trim();
  const recordCode = String(record.code || "").trim();
  return Boolean(
    (incomingRootId && (recordRootId === incomingRootId || recordId === incomingRootId)) ||
      (incomingId && (recordId === incomingId || recordRootId === incomingId)) ||
      (incomingCode && recordCode === incomingCode)
  );
}

function buildNextPresentationArtifactRevision(
  existingRecords: Array<Record<string, unknown>>,
  incoming: Record<string, unknown>,
  fallbackRootPrefix: string
) {
  const incomingId = String(incoming.id || "").trim();
  const incomingCode = String(incoming.code || "").trim();
  const incomingRootId = String(incoming.rootId || "").trim();
  const related = existingRecords
    .filter((record) => record && typeof record === "object")
    .filter((record) => matchesPresentationRevisionCandidate(record, incomingId, incomingCode, incomingRootId))
    .sort(
      (a, b) =>
        presentationRevisionVersionValue(b) - presentationRevisionVersionValue(a) ||
        presentationRevisionTimestampValue(b) - presentationRevisionTimestampValue(a)
    );
  const latest = related[0] || null;
  const rootId = String(incomingRootId || (latest && (latest.rootId || latest.id || latest.recordId)) || incomingId || `${fallbackRootPrefix}_${Date.now()}`).trim();
  const nextVersion = latest
    ? Math.max(presentationRevisionVersionValue(latest), presentationRevisionVersionValue(incoming), 0) + 1
    : Math.max(presentationRevisionVersionValue(incoming), 1);
  const createdAt = String((latest && latest.createdAt) || incoming.createdAt || nowIso()).trim();
  const previousId = String((latest && (latest.id || latest.recordId)) || incomingId || "").trim();
  const nextId = latest ? `${rootId}_v${nextVersion}` : (incomingId || `${rootId}_v${nextVersion}`);
  return {
    id: nextId,
    rootId,
    previousId: previousId && previousId !== nextId ? previousId : "",
    version: nextVersion,
    createdAt
  };
}

function normalizeReferenceList(item: Record<string, unknown>) {
  if (Array.isArray(item.references) && item.references.length) {
    return item.references.filter((entry) => entry && typeof entry === "object") as Array<Record<string, unknown>>;
  }
  if (item.reference && typeof item.reference === "object") {
    return [item.reference as Record<string, unknown>];
  }
  return [];
}

function categoryBriefTemplates(category: string) {
  const normalized = String(category || "").toLowerCase();
  if (/(athleisure|activewear|sportswear|fitness|apparel|fashion)/i.test(normalized)) {
    return [
      {
        title: "Performance Comfort Proof",
        angle: "Performance + comfort without compromise",
        hookPattern: "I stopped settling for activewear that looks good but fails once I start moving.",
        offerFrame: "Everyday-to-training versatility with performance credibility",
        formats: ["UGC demo", "Comparison carousel", "Founder/product walkthrough"]
      },
      {
        title: "Fit Confidence Reset",
        angle: "Confidence comes from fit proof, not aspiration-only imagery",
        hookPattern: "The difference between pieces I wear once and the set I reach for every week.",
        offerFrame: "Fit confidence, opacity, support, and consistency across body types",
        formats: ["Try-on proof", "Body-shape testimonial", "Problem/solution short reel"]
      }
    ];
  }
  if (/(beauty|skincare|cosmetic)/i.test(normalized)) {
    return [
      {
        title: "Routine Simplification Proof",
        angle: "Reduce routine complexity while keeping visible outcomes",
        hookPattern: "I cut my routine in half and my skin got better.",
        offerFrame: "Visible outcome with lower effort and fewer steps",
        formats: ["Routine breakdown", "Before/after diary", "Ingredient explainer"]
      },
      {
        title: "Sensitive Skin Confidence",
        angle: "Credibility for cautious buyers who fear irritation",
        hookPattern: "I wanted results without the recovery period.",
        offerFrame: "Gentle efficacy with trust-building proof",
        formats: ["Testimonial montage", "Creator review", "Derm-style explainer"]
      }
    ];
  }
  return [
    {
      title: "Pain-to-Relief Proof",
      angle: "Lead with the clearest recurring customer tension",
      hookPattern: "I kept running into the same problem until I changed this one thing.",
      offerFrame: "Reduce friction and make the next action obvious",
      formats: ["UGC problem/solution", "Demo walkthrough", "Comparison testimonial"]
    },
    {
      title: "Decision Confidence Stack",
      angle: "Help the buyer justify switching or finally deciding",
      hookPattern: "What finally convinced me this was worth trying.",
      offerFrame: "Proof, reassurance, and objection handling",
      formats: ["Proof-first static", "Review montage", "Founder answer format"]
    }
  ];
}

function synthesizeCreativeBriefs(input: {
  workspaceId: string;
  productId?: string;
  selectedInsights: Array<Record<string, unknown>>;
  personaItems: Array<Record<string, unknown>>;
  pneCombos: Array<Record<string, unknown>>;
  brandProfile?: Record<string, unknown> | null;
  limit?: number;
}) {
  const brandProfile = (input.brandProfile && typeof input.brandProfile === "object" ? input.brandProfile : {}) as Record<string, unknown>;
  const analysisJson =
    brandProfile.analysisJson && typeof brandProfile.analysisJson === "object"
      ? (brandProfile.analysisJson as Record<string, unknown>)
      : {};
  const brandGuidelines =
    analysisJson.brandGuidelines && typeof analysisJson.brandGuidelines === "object"
      ? (analysisJson.brandGuidelines as Record<string, unknown>)
      : {};
  const messagingPillars = Array.isArray(brandGuidelines.messagingPillars)
    ? brandGuidelines.messagingPillars.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const proofPoints = Array.isArray(brandGuidelines.proofPoints)
    ? brandGuidelines.proofPoints.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const ctaStyles = Array.isArray(brandGuidelines.ctaStyles)
    ? brandGuidelines.ctaStyles.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const toneTraits = Array.isArray(brandGuidelines.toneTraits)
    ? brandGuidelines.toneTraits.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const positioningSummary = String(brandGuidelines.positioningSummary || "").trim();
  const brandKit =
    analysisJson.brandKit && typeof analysisJson.brandKit === "object"
      ? (analysisJson.brandKit as Record<string, unknown>)
      : {};
  const brandValueProps = Array.isArray(brandKit.valueProps)
    ? brandKit.valueProps.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const visualSignals = Array.isArray(brandKit.visualSignals)
    ? brandKit.visualSignals.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const category = String(brandProfile.category || "general").trim();
  const brandName = String(brandProfile.companyName || brandProfile.brandName || "Brand").trim();
  const targetAudience = String(brandProfile.targetAudience || "High-intent customers").trim();
  const productsCatalog = Array.isArray(brandProfile.productsCatalog)
    ? brandProfile.productsCatalog.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const productFocus = productsCatalog[0] || `${category} offer`;
  const selectedInsights = input.selectedInsights
    .map((item) => ({
      id: String(item.id || item.insightKey || createHash("sha1").update(JSON.stringify(item)).digest("hex").slice(0, 8)),
      insight: String(item.refinedInsight || item.insight || item.text || "").trim(),
      mentionCount: Number(item.mentionCount || 0),
      uniqueUserCount: Number(item.uniqueUserCount || 0),
      references: normalizeReferenceList(item)
    }))
    .filter((item) => item.insight);
  const personaItems = input.personaItems
    .map((item, idx) => ({
      id: String(item.id || `persona_${idx + 1}`),
      persona: String(item.persona || "").trim(),
      need: String(item.need || "").trim(),
      emotion: String(item.emotion || "").trim(),
      mentionCount: Number(item.mentionCount || 0),
      uniqueUserCount: Number(item.uniqueUserCount || 0),
      confidence: Number(item.confidence || 0)
    }))
    .filter((item) => item.persona || item.need || item.emotion);
  const pneCombos = input.pneCombos
    .map((item, idx) => ({
      id: String(item.id || `pne_${idx + 1}`),
      persona: String(item.persona || "").trim(),
      need: String(item.need || "").trim(),
      emotion: String(item.emotion || "").trim(),
      angle: String(item.angle || "").trim(),
      isPrimary: Boolean(item.isPrimary),
      mentionCount: Number(item.mentionCount || 0),
      uniqueUserCount: Number(item.uniqueUserCount || 0),
      confidence: Number(item.confidence || 0)
    }))
    .filter((item) => item.persona || item.need || item.emotion);
  const templates = categoryBriefTemplates(category);
  const limit = Math.max(1, Math.min(templates.length, Number.isFinite(input.limit) ? Number(input.limit) : 2));
  const topInsight = selectedInsights[0];
  const topPersona = personaItems[0];
  const rankedCombos = (pneCombos.length ? pneCombos : topPersona ? [{
    id: topPersona.id,
    persona: topPersona.persona,
    need: topPersona.need,
    emotion: topPersona.emotion,
    angle: `${topPersona.need} -> ${topPersona.emotion}`,
    isPrimary: true,
    mentionCount: topPersona.mentionCount,
    uniqueUserCount: topPersona.uniqueUserCount,
    confidence: topPersona.confidence
  }] : []).sort((a, b) => {
    const scoreA = (a.isPrimary ? 100000 : 0) + (a.mentionCount || 0) * 3 + (a.uniqueUserCount || 0) * 2 + (a.confidence || 0) * 10;
    const scoreB = (b.isPrimary ? 100000 : 0) + (b.mentionCount || 0) * 3 + (b.uniqueUserCount || 0) * 2 + (b.confidence || 0) * 10;
    return scoreB - scoreA;
  });

  const briefs = templates.slice(0, limit).map((template, idx) => {
    const combo = rankedCombos[idx % Math.max(rankedCombos.length, 1)] || null;
    const personaLabel = combo?.persona || topPersona?.persona || targetAudience;
    const needLabel = combo?.need || topPersona?.need || `confidence when buying ${productFocus}`;
    const emotionLabel = combo?.emotion || topPersona?.emotion || "certainty";
    const evidencePool = selectedInsights.slice(0, 3);
    const totalMentions = evidencePool.reduce((sum, item) => sum + (item.mentionCount || 0), 0);
    const totalUsers = evidencePool.reduce((sum, item) => sum + (item.uniqueUserCount || 0), 0);
    const primaryInsight = evidencePool[0]?.insight || topInsight?.insight || `${personaLabel} is looking for ${needLabel} with more ${emotionLabel}.`;
    const briefCode = `BRF-${String(category || "GEN").replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase() || "GEN"}-${String(idx + 1).padStart(2, "0")}`;
    const strategyAngle = String(combo?.angle || template.angle || "").trim();
    const hookOptions = [
      template.hookPattern,
      `${personaLabel} wants ${needLabel}, but most options increase doubt instead of reducing it.`,
      `Why ${personaLabel.toLowerCase()} keeps rejecting ${productFocus} until they see this proof.`
    ];
    const formatSuggestions = Array.from(new Set([...(template.formats || []), "UGC testimonial", "Static proof card"])).slice(0, 4);
    const proofStack = Array.from(new Set([...(proofPoints || []), ...(messagingPillars || []).slice(0, 2)])).slice(0, 4);
    const objections = [
      `Will ${productFocus} actually solve ${needLabel.toLowerCase()}?`,
      `Can ${brandName} prove it is better than the alternatives already in rotation?`,
      `Is the price justified by real-world repeat use?`
    ];
    const ctas = Array.from(new Set([...(ctaStyles || []), "Shop the proof set", "See why customers switch"])).slice(0, 4);
    const references = evidencePool.flatMap((item) =>
      item.references.map((reference) => ({
        title: String(reference.title || reference.sourceTitle || item.insight.slice(0, 72)),
        url: String(reference.url || reference.sourceUrl || "#"),
        subreddit: String(reference.subreddit || item.references[0]?.subreddit || "reddit"),
        author: reference.author ? String(reference.author) : undefined,
        score: Number(reference.score || 0)
      }))
    );
    return {
      id: `${briefCode.toLowerCase()}_${Date.now()}_${idx + 1}`,
      code: briefCode,
      version: idx + 1,
      title: template.title,
      category,
      objective: "Create a production-ready performance marketing direction",
      audience: personaLabel,
      angle: strategyAngle,
      insightCore: primaryInsight,
      targetMoment: `${personaLabel} is evaluating ${productFocus} and needs proof that resolves ${needLabel.toLowerCase()} without increasing ${emotionLabel.toLowerCase()}.`,
      hook: hookOptions[0],
      hookOptions,
      audienceFraming: `${personaLabel} needs a message that acknowledges ${needLabel.toLowerCase()} and replaces ${emotionLabel.toLowerCase()} with clarity.`,
      offerFrame: template.offerFrame,
      proofPoints: proofStack.length ? proofStack : [`Evidence from customer research should anchor the claim about ${needLabel.toLowerCase()}.`],
      objections,
      ctas,
      formatSuggestions,
      tone: toneTraits.length ? toneTraits.join(" · ") : "direct · credible · conversion-aware",
      successMetrics: {
        hookHoldTarget: ">4s",
        ctrTarget: "1.5%+",
        cvrTarget: "2.5%+",
        roasTarget: "3.0x+"
      },
      brandContext: {
        companyName: brandName,
        category,
        targetAudience,
        productFocus,
        productsCatalog: productsCatalog.slice(0, 6),
        valueProps: brandValueProps.slice(0, 6),
        messagingPillars: messagingPillars.slice(0, 6),
        toneTraits: toneTraits.slice(0, 6),
        proofPoints: proofPoints.slice(0, 6),
        visualSignals: visualSignals.slice(0, 6),
        positioningSummary
      },
      customerSummary: {
        leadPersona: personaLabel,
        leadNeed: needLabel,
        leadEmotion: emotionLabel,
        leadAngle: strategyAngle,
        primaryPneId: String(combo?.id || "").trim(),
        supportingInsightCount: evidencePool.length,
        supportingReferenceCount: references.length
      },
      sourceSummary: {
        selectedInsightCount: evidencePool.length,
        mentionCount: totalMentions,
        uniqueUserCount: totalUsers,
        personaCount: personaItems.length,
        pneCount: rankedCombos.length,
        activePneId: String(combo?.id || "").trim()
      },
      sourceRefs: {
        selectedInsightIds: evidencePool.map((item) => item.id).filter(Boolean),
        personaIds: combo?.id ? [combo.id] : topPersona?.id ? [topPersona.id] : [],
        pneIds: combo?.id ? [combo.id] : []
      },
      references,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      productId: input.productId || undefined,
      autoDerivedFromCustomer: true,
      localFallback: false
    };
  });

  return {
    brandProfile: {
      companyName: brandName,
      brandUrl: String(brandProfile.brandUrl || ""),
      category,
      targetAudience,
      productsCatalog
    },
    sourceState: {
      selectedInsightCount: selectedInsights.length,
      personaCount: personaItems.length,
      pneCount: rankedCombos.length
    },
    briefs
  };
}

function sceneDurationPattern(format: string) {
  const normalized = String(format || "").toLowerCase();
  if (normalized.includes("carousel")) return [3, 4, 4, 4, 3];
  if (normalized.includes("static")) return [2, 3, 3, 3, 2];
  return [2, 3, 4, 4, 3];
}

function buildStoryboardScenes(input: {
  brief: Record<string, unknown>;
  format: string;
  hook: string;
  voiceoverLines: string[];
}) {
  const pattern = sceneDurationPattern(input.format);
  const audience = String(input.brief.audience || "buyer");
  const angle = String(input.brief.angle || "angle");
  const proofPoints = Array.isArray(input.brief.proofPoints)
    ? input.brief.proofPoints.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const objections = Array.isArray(input.brief.objections)
    ? input.brief.objections.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const overlays = [
    "Problem-first hook",
    "What buyers keep running into",
    proofPoints[0] || "Real proof point",
    objections[0] || "Objection resolved",
    "CTA / next action"
  ];
  const visuals = [
    `Open on ${audience.toLowerCase()} in a real-use moment with immediate friction visible`,
    `Show the pain pattern or failed alternative tied to ${angle.toLowerCase()}`,
    "Demonstrate the product solving the exact use case with close-up proof",
    "Layer social proof, review language, or comparison evidence on screen",
    "End with product + offer framing + clear CTA"
  ];
  const shotIntents = [
    "Thumb-stop interruption",
    "Relatable problem articulation",
    "Proof demonstration",
    "Trust + objection handling",
    "Decision push"
  ];
  const transitions = ["Hard cut", "Match cut", "Zoom detail", "Text-led cut", "End card hold"];
  return pattern.map((durationSec, idx) => ({
    index: idx + 1,
    beat: shotIntents[idx],
    durationSec,
    shotIntent: shotIntents[idx],
    visualCue: visuals[idx],
    overlay: overlays[idx],
    voiceoverLine: input.voiceoverLines[idx] || input.voiceoverLines[input.voiceoverLines.length - 1] || "",
    transition: transitions[idx]
  }));
}

function synthesizeStoryboards(input: {
  workspaceId: string;
  productId?: string;
  briefs: Array<Record<string, unknown>>;
  brandProfile?: Record<string, unknown> | null;
  limit?: number;
}) {
  const brandProfile = (input.brandProfile && typeof input.brandProfile === "object" ? input.brandProfile : {}) as Record<string, unknown>;
  const category = String(brandProfile.category || "general").trim();
  const companyName = String(brandProfile.companyName || brandProfile.brandName || "Brand").trim();
  const limit = Math.max(1, Math.min(3, Number.isFinite(input.limit) ? Number(input.limit) : 2));
  const briefVariants = input.briefs.filter((brief) => brief && typeof brief === "object").slice(0, Math.max(limit, 1));
  const defaultFormats = ["UGC reel", "Problem/solution short", "Testimonial proof cut"];
  const storyboards = briefVariants.slice(0, limit).map((brief, idx) => {
    const formatSuggestions = Array.isArray(brief.formatSuggestions)
      ? brief.formatSuggestions.map((value) => String(value || "").trim()).filter(Boolean)
      : [];
    const chosenFormat = formatSuggestions[0] || defaultFormats[idx % defaultFormats.length];
    const hook = String(brief.hook || "").trim() || "Open with the buyer problem immediately.";
    const audience = String(brief.audience || "buyer");
    const angle = String(brief.angle || "conversion angle");
    const targetMoment = String(brief.targetMoment || "");
    const proofPoints = Array.isArray(brief.proofPoints)
      ? brief.proofPoints.map((value) => String(value || "").trim()).filter(Boolean)
      : [];
    const objections = Array.isArray(brief.objections)
      ? brief.objections.map((value) => String(value || "").trim()).filter(Boolean)
      : [];
    const ctas = Array.isArray(brief.ctas) ? brief.ctas.map((value) => String(value || "").trim()).filter(Boolean) : [];
    const references = Array.isArray(brief.references) ? brief.references : [];
    const voiceoverLines = [
      hook,
      `${audience} is trying to solve ${String(brief.offerFrame || angle).toLowerCase()} without creating more doubt.`,
      proofPoints[0] || `Show exactly how ${companyName} resolves the real use case.`,
      objections[0] || "Answer the biggest hesitation directly with evidence.",
      ctas[0] || "Show the next action and why now is the right time."
    ];
    const scenes = buildStoryboardScenes({ brief, format: chosenFormat, hook, voiceoverLines });
    const totalDurationSec = scenes.reduce((sum, scene) => sum + Number(scene.durationSec || 0), 0);
    const storyboardCode = `SB-${String(category || "GEN").replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase() || "GEN"}-${String(idx + 1).padStart(2, "0")}`;
    return {
      id: `${storyboardCode.toLowerCase()}_${Date.now()}_${idx + 1}`,
      code: storyboardCode,
      version: idx + 1,
      briefId: String(brief.id || ""),
      briefCode: String(brief.code || ""),
      title: `${String(brief.title || "Creative Brief")} Storyboard`,
      format: chosenFormat,
      audience,
      angle,
      objective: "Translate the brief into a generation-ready scene plan",
      targetMoment,
      hook,
      pacing: totalDurationSec <= 12 ? "fast" : totalDurationSec <= 18 ? "medium" : "deliberate",
      totalDurationSec,
      scenes,
      script: {
        opening: voiceoverLines[0],
        body: voiceoverLines.slice(1, -1),
        closing: voiceoverLines[voiceoverLines.length - 1],
        fullVoiceover: voiceoverLines.join(" "),
        overlays: scenes.map((scene) => scene.overlay)
      },
      audioDirection: {
        voiceoverTone: "credible, direct, fast-moving",
        musicMood: "energetic with clean build",
        sfxNotes: ["first beat hit on hook", "soft whoosh between proof and objection", "clean end-card resolve"]
      },
      generationReady: {
        templateHint: chosenFormat,
        promptSummary: `${companyName} ${chosenFormat} for ${audience}. Lead with ${hook}. Resolve ${String(
          brief.offerFrame || angle
        ).toLowerCase()} with proof and end on ${ctas[0] || "clear CTA"}.`,
        scenePlan: scenes.map((scene) => `${scene.index}. ${scene.shotIntent} - ${scene.visualCue}`).join(" | ")
      },
      brandContext: {
        companyName: String((brief.brandContext as Record<string, unknown> | undefined)?.companyName || companyName).trim(),
        category: String((brief.brandContext as Record<string, unknown> | undefined)?.category || category).trim(),
        targetAudience: String((brief.brandContext as Record<string, unknown> | undefined)?.targetAudience || brandProfile.targetAudience || "").trim(),
        productFocus: String((brief.brandContext as Record<string, unknown> | undefined)?.productFocus || "").trim(),
        productsCatalog: Array.isArray((brief.brandContext as Record<string, unknown> | undefined)?.productsCatalog)
          ? (((brief.brandContext as Record<string, unknown>).productsCatalog as Array<unknown>).map((value) => String(value || "").trim()).filter(Boolean).slice(0, 12))
          : [],
        valueProps: Array.isArray((brief.brandContext as Record<string, unknown> | undefined)?.valueProps)
          ? (((brief.brandContext as Record<string, unknown>).valueProps as Array<unknown>).map((value) => String(value || "").trim()).filter(Boolean).slice(0, 12))
          : [],
        messagingPillars: Array.isArray((brief.brandContext as Record<string, unknown> | undefined)?.messagingPillars)
          ? (((brief.brandContext as Record<string, unknown>).messagingPillars as Array<unknown>).map((value) => String(value || "").trim()).filter(Boolean).slice(0, 12))
          : [],
        toneTraits: Array.isArray((brief.brandContext as Record<string, unknown> | undefined)?.toneTraits)
          ? (((brief.brandContext as Record<string, unknown>).toneTraits as Array<unknown>).map((value) => String(value || "").trim()).filter(Boolean).slice(0, 12))
          : [],
        proofPoints: Array.isArray((brief.brandContext as Record<string, unknown> | undefined)?.proofPoints)
          ? (((brief.brandContext as Record<string, unknown>).proofPoints as Array<unknown>).map((value) => String(value || "").trim()).filter(Boolean).slice(0, 12))
          : [],
        visualSignals: Array.isArray((brief.brandContext as Record<string, unknown> | undefined)?.visualSignals)
          ? (((brief.brandContext as Record<string, unknown>).visualSignals as Array<unknown>).map((value) => String(value || "").trim()).filter(Boolean).slice(0, 12))
          : [],
        positioningSummary: String((brief.brandContext as Record<string, unknown> | undefined)?.positioningSummary || "").trim()
      },
      customerSummary: {
        leadPersona: String((brief.customerSummary as Record<string, unknown> | undefined)?.leadPersona || audience).trim(),
        leadNeed: String((brief.customerSummary as Record<string, unknown> | undefined)?.leadNeed || "").trim(),
        leadEmotion: String((brief.customerSummary as Record<string, unknown> | undefined)?.leadEmotion || "").trim(),
        leadAngle: String((brief.customerSummary as Record<string, unknown> | undefined)?.leadAngle || angle).trim(),
        primaryPneId: String((brief.customerSummary as Record<string, unknown> | undefined)?.primaryPneId || "").trim()
      },
      sourceSummary: {
        briefCode: String(brief.code || ""),
        proofPointCount: proofPoints.length,
        objectionCount: objections.length,
        referenceCount: references.length,
        activePneId: String((brief.customerSummary as Record<string, unknown> | undefined)?.primaryPneId || "").trim()
      },
      sourceRefs: {
        selectedInsightIds: Array.isArray((brief.sourceRefs as Record<string, unknown> | undefined)?.selectedInsightIds)
          ? (((brief.sourceRefs as Record<string, unknown>).selectedInsightIds as Array<unknown>).map((value) => String(value || "").trim()).filter(Boolean).slice(0, 24))
          : [],
        personaIds: Array.isArray((brief.sourceRefs as Record<string, unknown> | undefined)?.personaIds)
          ? (((brief.sourceRefs as Record<string, unknown>).personaIds as Array<unknown>).map((value) => String(value || "").trim()).filter(Boolean).slice(0, 24))
          : [],
        pneIds: Array.isArray((brief.sourceRefs as Record<string, unknown> | undefined)?.pneIds)
          ? (((brief.sourceRefs as Record<string, unknown>).pneIds as Array<unknown>).map((value) => String(value || "").trim()).filter(Boolean).slice(0, 24))
          : []
      },
      references,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      productId: input.productId || undefined,
      autoDerivedFromCustomer: true,
      localFallback: false
    };
  });
  return {
    brandProfile: {
      companyName,
      category,
      brandUrl: String(brandProfile.brandUrl || "")
    },
    briefCount: briefVariants.length,
    storyboards
  };
}

function buildPresentationBriefState(workspaceId: string, productId?: string) {
  const customerState = buildCustomerBrainPneState(workspaceId, productId);
  const brandProfile = getWorkspaceBrandProfile(workspaceId);
  const savedBriefs = listBriefLibraryRecords(workspaceId, 18, productId);
  const briefs = savedBriefs.length
    ? savedBriefs
    : synthesizeCreativeBriefs({
        workspaceId,
        productId,
        selectedInsights: Array.isArray(customerState.selectedInsights) ? customerState.selectedInsights : [],
        personaItems: Array.isArray(customerState.personaItems) ? customerState.personaItems : [],
        pneCombos: Array.isArray(customerState.pneCombos) ? customerState.pneCombos : [],
        brandProfile,
        limit: 2
      }).briefs;
  return {
    brandProfile,
    selectedInsights: customerState.selectedInsights,
    personaItems: customerState.personaItems,
    pneCombos: customerState.pneCombos,
    briefs,
    latestBrief: briefs[0] || null,
    autoDerivedFromCustomer: savedBriefs.length === 0 && briefs.length > 0
  };
}

function buildPresentationStoryboardState(workspaceId: string, productId?: string) {
  const briefState = buildPresentationBriefState(workspaceId, productId);
  const savedStoryboards = listStoryboardLibraryRecords(workspaceId, 18, productId);
  const storyboards = savedStoryboards.length
    ? savedStoryboards
    : synthesizeStoryboards({
        workspaceId,
        productId,
        briefs: Array.isArray(briefState.briefs) ? (briefState.briefs as Array<Record<string, unknown>>) : [],
        brandProfile: briefState.brandProfile as Record<string, unknown> | null | undefined,
        limit: 2
      }).storyboards;
  return {
    ...briefState,
    storyboards,
    latestStoryboard: storyboards[0] || null,
    autoDerivedFromCustomer: savedStoryboards.length === 0 && storyboards.length > 0
  };
}

function buildGenerationStrategyPacket(workspaceId: string, productId?: string) {
  const brandProfile = getWorkspaceBrandProfile(workspaceId);
  const briefState = buildPresentationBriefState(workspaceId, productId);
  const storyboardState = buildPresentationStoryboardState(workspaceId, productId);
  return {
    brandProfile: brandProfile || null,
    latestBrief: briefState.latestBrief || null,
    latestStoryboard: storyboardState.latestStoryboard || null,
    briefCount: Array.isArray(briefState.briefs) ? briefState.briefs.length : 0,
    storyboardCount: Array.isArray(storyboardState.storyboards) ? storyboardState.storyboards.length : 0
  };
}

function compileStructuredGenerationPrompt(packet: ReturnType<typeof buildGenerationStrategyPacket>) {
  const brandProfile = isPlainObject(packet.brandProfile) ? packet.brandProfile : {};
  const brief = isPlainObject(packet.latestBrief) ? packet.latestBrief : {};
  const storyboard = isPlainObject(packet.latestStoryboard) ? packet.latestStoryboard : {};
  const proofPoints = Array.isArray(brief.proofPoints)
    ? brief.proofPoints.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const scenes = Array.isArray(storyboard.scenes)
    ? storyboard.scenes
        .map((scene: any) => `${scene.index || "?"}. ${String(scene.shotIntent || scene.beat || "").trim()} - ${String(scene.visualCue || "").trim()}`.trim())
        .filter(Boolean)
    : [];
  return [
    String(brandProfile.companyName || "").trim() ? `Brand: ${String(brandProfile.companyName).trim()}` : "",
    String(brandProfile.category || "").trim() ? `Category: ${String(brandProfile.category).trim()}` : "",
    String(brief.audience || "").trim() ? `Audience: ${String(brief.audience).trim()}` : "",
    String(brief.angle || "").trim() ? `Angle: ${String(brief.angle).trim()}` : "",
    String(brief.insightCore || "").trim() ? `Core insight: ${String(brief.insightCore).trim()}` : "",
    proofPoints.length ? `Proof points: ${proofPoints.join(" | ")}` : "",
    String(storyboard.hook || brief.hook || "").trim() ? `Hook: ${String(storyboard.hook || brief.hook).trim()}` : "",
    scenes.length ? `Scene plan: ${scenes.join(" || ")}` : "",
    String(storyboard.script && (storyboard.script as Record<string, unknown>).fullVoiceover || "").trim()
      ? `Voiceover: ${String((storyboard.script as Record<string, unknown>).fullVoiceover || "").trim()}`
      : ""
  ].filter(Boolean).join("\n");
}

function upsertCustomerBrainState(input: {
  workspaceId: string;
  productId: string;
  nodeId?: string;
  selectedInsights?: Array<Record<string, unknown>>;
  personaItems?: Array<Record<string, unknown>>;
  pneCombos?: Array<Record<string, unknown>>;
  selectionMode?: string;
  meta?: Record<string, unknown>;
}) {
  const existing = getCustomerBrainState(input.workspaceId, input.productId, input.nodeId || "customer");
  const next = {
    workspaceId: input.workspaceId,
    productId: input.productId,
    nodeId: input.nodeId || "customer",
    selectedInsights: Array.isArray(input.selectedInsights) ? input.selectedInsights : existing.selectedInsights,
    personaItems: Array.isArray(input.personaItems) ? input.personaItems : existing.personaItems,
    pneCombos: Array.isArray(input.pneCombos) ? input.pneCombos : existing.pneCombos,
    selectionMode: String(input.selectionMode || existing.selectionMode || "none"),
    meta: { ...(existing.meta || {}), ...((input.meta && typeof input.meta === "object") ? input.meta : {}) },
    updatedAt: nowIso()
  };
  upsertCustomerBrainStateStmt.run(
    next.workspaceId,
    next.productId,
    next.nodeId,
    JSON.stringify(next.selectedInsights || []),
    JSON.stringify(next.personaItems || []),
    JSON.stringify(next.pneCombos || []),
    next.selectionMode,
    JSON.stringify(next.meta || {}),
    next.updatedAt
  );
  return getCustomerBrainState(next.workspaceId, next.productId, next.nodeId);
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
      apifyApiKey: String(keys.apifyApiKey || ""),
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
    const fallbackRepo = resolve(process.cwd(), "tmp", "awesome-comfyui-templates");
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

function cloneCanvasDoc<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function slugifyWorkflowName(value: string) {
  return String(value || "workflow")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "workflow";
}

function workflowCode(value: string) {
  return `WF-${slugifyWorkflowName(value).slice(0, 16).toUpperCase()}`;
}

function generationCode(runId: string) {
  const normalized = String(runId || "").replace(/[^a-z0-9]+/gi, "").toUpperCase();
  return `GEN-${normalized.slice(-12) || "RUN"}`;
}

function nodeUiState(node: CanvasNode) {
  const config = node.config && typeof node.config === "object" ? node.config : ({ workflowRef: "" } as GenerationNodeConfig);
  const uiState =
    config.uiState && typeof config.uiState === "object"
      ? (config.uiState as Record<string, unknown>)
      : {};
  return { config, uiState };
}

function artifactRunSignature(row: unknown) {
  if (!row || typeof row !== "object") return "";
  const candidate = row as Record<string, unknown>;
  const data = candidate.data && typeof candidate.data === "object" ? (candidate.data as Record<string, unknown>) : {};
  const step = data.step && typeof data.step === "object" ? (data.step as Record<string, unknown>) : {};
  const stepId = String(step.id || "").trim();
  if (stepId) return `step:${stepId}`;
  return [
    String(candidate.wfCode || "").trim(),
    String(candidate.genCode || "").trim(),
    String(candidate.summary || "").trim()
  ]
    .filter(Boolean)
    .join("::");
}

function upsertUiRunRow(node: CanvasNode, runRow: Record<string, unknown>, limit = 12) {
  const { config, uiState } = nodeUiState(node);
  const existingRows = Array.isArray(uiState.runs) ? [...uiState.runs] : [];
  uiState.runs = [runRow, ...existingRows.filter((row) => artifactRunSignature(row) !== artifactRunSignature(runRow))].slice(0, limit);
  node.config = {
    ...config,
    uiState
  };
}

function persistGenerationArtifactsToCanvasDoc(args: {
  doc: CanvasDocument;
  runId: string;
  stepId: string;
  nodeId: string;
  artifacts: GenerationArtifact[];
  timestampLabel?: string;
}) {
  const { doc, runId, stepId, nodeId, artifacts } = args;
  if (!doc || !Array.isArray(doc.nodes) || !artifacts.length) return { changed: false, doc };
  const nextDoc = cloneCanvasDoc(doc);
  const targetNode = nextDoc.nodes.find((node) => String(node.id || "") === String(nodeId || ""));
  const assetNode = nextDoc.nodes.find((node) => String(node.id || "") === "assetgen");
  if (!targetNode) return { changed: false, doc };
  const stamp = String(args.timestampLabel || "").trim() || new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const primary = artifacts[0];
  const metadata = primary && primary.metadata && typeof primary.metadata === "object"
    ? (primary.metadata as Record<string, unknown>)
    : {};
  const workflowRef = String(metadata.workflowRef || targetNode.title || nodeId || "workflow").trim() || "workflow";
  const briefCode = String(metadata.briefCode || "").trim();
  const storyboardCode = String(metadata.storyboardCode || "").trim();
  const summaryParts = [workflowRef, briefCode, storyboardCode].filter(Boolean);
  const baseRun = {
    date: stamp,
    count: String(artifacts.length || 1),
    wfName: workflowRef,
    wfCode: workflowCode(workflowRef),
    genCode: generationCode(runId),
    url: String(primary?.previewUri || primary?.uri || "#"),
    data: {
      artifacts,
      step: {
        id: stepId,
        nodeId,
        nodeKind: String(targetNode.kind || ""),
        status: "completed"
      },
      metadata
    }
  };

  upsertUiRunRow(targetNode, {
    ...baseRun,
    summary: `${summaryParts.join(" · ") || "Generation run"} · ${artifacts.length || 1} asset${(artifacts.length || 1) === 1 ? "" : "s"}`
  });
  const targetUi = nodeUiState(targetNode).uiState;
  targetUi.connected = true;
  targetUi.sync = "just now";
  if (targetNode.config) targetNode.config.uiState = targetUi;

  if (assetNode) {
    upsertUiRunRow(assetNode, {
      ...baseRun,
      summary: `${workflowRef} · ${artifacts.length || 1} asset${(artifacts.length || 1) === 1 ? "" : "s"}`
    });
    const assetUi = nodeUiState(assetNode).uiState;
    assetUi.status = "ready";
    assetUi.connected = true;
    assetUi.sync = "just now";
    if (assetNode.config) assetNode.config.uiState = assetUi;
  }

  nextDoc.updatedAt = new Date().toISOString();
  return { changed: true, doc: nextDoc };
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
  const storedArtifacts: GenerationArtifact[] = [];
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

    storedArtifacts.push(stored);
  }

  if (storedArtifacts.length) {
    const snapshot = getWorkspace(workspaceId);
    const doc = snapshot.documents[productId];
    if (doc) {
      const persisted = persistGenerationArtifactsToCanvasDoc({
        doc,
        runId,
        stepId,
        nodeId,
        artifacts: storedArtifacts
      });
      if (persisted.changed) {
        const updatedDoc = upsertCanvas(workspaceId, productId, persisted.doc);
        broadcast(workspaceId, {
          type: "canvas.updated",
          workspaceId,
          productId,
          doc: updatedDoc,
          updatedAt: nowIso()
        });
      }
    }
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

function deriveLocalRedditProviderIssue(input: {
  findingCount: number;
  apifyToken: string;
  diagnostics?: { attempts?: Array<{ source?: string; status?: string; reason?: string; findingCount?: number }> } | null;
}) {
  const attempts = Array.isArray(input.diagnostics?.attempts) ? input.diagnostics?.attempts : [];
  const apifyAttempt = attempts.find((attempt) => String(attempt.source || "") === "apify") || null;
  const pullpushAttempt = attempts.find((attempt) => String(attempt.source || "") === "pullpush") || null;
  if (!String(input.apifyToken || "").trim() && input.findingCount === 0) {
    return {
      code: "missing_apify_token",
      source: "apify",
      message: "Add an Apify API key or connect your Apify account to run Reddit research reliably.",
      action: "Open Settings or connect the Apify provider, then rerun the Reddit node."
    };
  }
  if (apifyAttempt && String(apifyAttempt.status || "") === "failed" && String(apifyAttempt.reason || "") === "no_items" && input.findingCount === 0) {
    return {
      code: "reddit_no_results",
      source: pullpushAttempt && String(pullpushAttempt.status || "") === "succeeded" ? "pullpush" : "reddit",
      message: "No Reddit findings were captured for this run.",
      action: "Try broadening the brand context, queries, or subreddits and rerun the node."
    };
  }
  return null;
}

function buildLocalRecurringSubreddits(findings: Array<{ subreddit?: string; sourceUrl?: string; sourceTitle?: string; text?: string; score?: number }>, limit = 12) {
  const map = new Map<string, { subreddit: string; postCount: number; scoreSum: number; topUrl: string; topTitle: string }>();
  findings.forEach((finding) => {
    const subreddit = String(finding.subreddit || "").trim() || "unknown";
    const current = map.get(subreddit) || {
      subreddit,
      postCount: 0,
      scoreSum: 0,
      topUrl: "",
      topTitle: ""
    };
    current.postCount += 1;
    current.scoreSum += Number(finding.score || 0);
    if (!current.topUrl && finding.sourceUrl) current.topUrl = String(finding.sourceUrl || "");
    if (!current.topTitle && finding.sourceTitle) current.topTitle = String(finding.sourceTitle || "");
    map.set(subreddit, current);
  });
  return Array.from(map.values())
    .sort((a, b) => b.postCount - a.postCount || b.scoreSum - a.scoreSum)
    .slice(0, Math.max(1, limit))
    .map((item) => ({
      subreddit: item.subreddit,
      postCount: item.postCount,
      scoreSum: item.scoreSum,
      topUrl: item.topUrl,
      topTitle: item.topTitle
    }));
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

app.get("/workspaces/:workspaceId/prompt-library", (req, res) => {
  const hostedBase = resolveHostedApiBase(getDesktopSettings());
  if (hostedBase) {
    void proxyHostedRequest(req, res, hostedBase).catch((error: any) => {
      res.status(502).json({ error: error?.message || "Hosted backend proxy failed" });
    });
    return;
  }
  const workspaceId = req.params.workspaceId || WORKSPACE_DEFAULT;
  const records = listPromptLibraryRecords(workspaceId, {
    productId: req.query.productId ? String(req.query.productId) : undefined,
    nodeId: req.query.nodeId ? String(req.query.nodeId) : undefined,
    q: req.query.q ? String(req.query.q) : undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined
  });
  res.json(records);
});

app.post("/workspaces/:workspaceId/prompt-library", (req, res) => {
  const hostedBase = resolveHostedApiBase(getDesktopSettings());
  if (hostedBase) {
    void proxyHostedRequest(req, res, hostedBase).catch((error: any) => {
      res.status(502).json({ error: error?.message || "Hosted backend proxy failed" });
    });
    return;
  }
  const workspaceId = req.params.workspaceId || WORKSPACE_DEFAULT;
  const title = String(req.body?.title || "").trim();
  const prompt = String(req.body?.prompt || "").trim();
  if (!title || !prompt) {
    res.status(400).json({ error: "title and prompt are required" });
    return;
  }
  const created = createPromptLibraryRecord(workspaceId, {
    productId: req.body?.productId ? String(req.body.productId) : undefined,
    nodeId: req.body?.nodeId ? String(req.body.nodeId) : undefined,
    title,
    prompt,
    metadata: req.body?.metadata && typeof req.body.metadata === "object" ? (req.body.metadata as Record<string, unknown>) : {}
  });
  res.status(201).json(created);
});

app.put("/workspaces/:workspaceId/prompt-library/:promptId", (req, res) => {
  const hostedBase = resolveHostedApiBase(getDesktopSettings());
  if (hostedBase) {
    void proxyHostedRequest(req, res, hostedBase).catch((error: any) => {
      res.status(502).json({ error: error?.message || "Hosted backend proxy failed" });
    });
    return;
  }
  const workspaceId = req.params.workspaceId || WORKSPACE_DEFAULT;
  const promptId = String(req.params.promptId || "");
  const title = String(req.body?.title || "").trim();
  const prompt = String(req.body?.prompt || "").trim();
  if (!promptId || !title || !prompt) {
    res.status(400).json({ error: "promptId, title and prompt are required" });
    return;
  }
  const updated = updatePromptLibraryRecord(workspaceId, promptId, {
    productId: req.body?.productId ? String(req.body.productId) : undefined,
    nodeId: req.body?.nodeId ? String(req.body.nodeId) : undefined,
    title,
    prompt,
    metadata: req.body?.metadata && typeof req.body.metadata === "object" ? (req.body.metadata as Record<string, unknown>) : {}
  });
  if (!updated) {
    res.status(404).json({ error: `Prompt not found: ${promptId}` });
    return;
  }
  res.json(updated);
});

app.delete("/workspaces/:workspaceId/prompt-library/:promptId", (req, res) => {
  const hostedBase = resolveHostedApiBase(getDesktopSettings());
  if (hostedBase) {
    void proxyHostedRequest(req, res, hostedBase).catch((error: any) => {
      res.status(502).json({ error: error?.message || "Hosted backend proxy failed" });
    });
    return;
  }
  const workspaceId = req.params.workspaceId || WORKSPACE_DEFAULT;
  const promptId = String(req.params.promptId || "");
  if (!promptId) {
    res.status(400).json({ error: "promptId is required" });
    return;
  }
  const ok = deletePromptLibraryRecord(workspaceId, promptId);
  if (!ok) {
    res.status(404).json({ error: `Prompt not found: ${promptId}` });
    return;
  }
  res.status(204).send();
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
    const workspaceId = String(req.body?.workspaceId || "").trim() || WORKSPACE_DEFAULT;
    const nodeId = String(req.body?.nodeId || "").trim() || "reddit";
    const productId = String(req.body?.productId || "").trim() || undefined;
    const brandAnalysis = (req.body?.brandAnalysis || {}) as Record<string, unknown>;
    const queries = Array.isArray(req.body?.queries) ? req.body.queries.filter((v: unknown) => typeof v === "string") : undefined;
    const subreddits = Array.isArray(req.body?.subreddits)
      ? req.body.subreddits.filter((v: unknown) => typeof v === "string")
      : undefined;
    const frequencyHours = Math.max(1, Number(req.body?.frequencyHours || 24));
    const settings = getDesktopSettings();
    const workspaceApifyToken = getWorkspaceProviderToken(workspaceId, "apify");
    const apifyToken = String(workspaceApifyToken || settings.keys.apifyApiKey || "").trim();
    const result = await runRedditScraper({
      brandAnalysis: brandAnalysis as any,
      queries,
      subreddits,
      apifyToken
    });
    const previousRuns = listRedditScrapeRuns(workspaceId, nodeId, 100);
    const providerIssue = deriveLocalRedditProviderIssue({
      findingCount: Array.isArray(result.findings) ? result.findings.length : 0,
      apifyToken,
      diagnostics: result.diagnostics
    });
    const derived = deriveLocalRedditRunState({
      findings: (Array.isArray(result.findings) ? result.findings : []) as Array<Record<string, unknown>>,
      previousRuns,
      limit: Number(req.body?.insightLimit || 12),
      providerIssue
    });
    const insights = derived.insights;
    const runAt = nowIso();
    const nextRunAt = new Date(Date.now() + frequencyHours * 60 * 60 * 1000).toISOString();
    const recurringSubreddits = buildLocalRecurringSubreddits(result.findings as Array<Record<string, unknown>>, Number(req.body?.subredditLimit || 12));
    const insightMeta = derived.meta;
    const persisted = persistRedditScrapeRun({
      workspaceId,
      nodeId,
      productId,
      status: "completed",
      runAt,
      nextRunAt,
      frequencyHours,
      findings: (Array.isArray(result.findings) ? result.findings : []) as Array<Record<string, unknown>>,
      insights: insights as Array<Record<string, unknown>>,
      insightsLibrary: derived.insightsLibrary as Array<Record<string, unknown>>,
      recurringSubreddits: recurringSubreddits as Array<Record<string, unknown>>,
      meta: insightMeta
    });
    res.json({
      ...result,
      insights,
      insightsLibrary: derived.insightsLibrary,
      recurringSubreddits,
      providerIssue,
      insightMeta,
      meta: insightMeta,
      frequencyHours,
      runAt,
      nextRunAt,
      runId: persisted.id
    });
  } catch (error: any) {
    const workspaceId = String(req.body?.workspaceId || "").trim() || WORKSPACE_DEFAULT;
    const nodeId = String(req.body?.nodeId || "").trim() || "reddit";
    const productId = String(req.body?.productId || "").trim() || undefined;
    const settings = getDesktopSettings();
    const workspaceApifyToken = getWorkspaceProviderToken(workspaceId, "apify");
    const providerIssue = deriveLocalRedditProviderIssue({
      findingCount: 0,
      apifyToken: String(workspaceApifyToken || settings.keys.apifyApiKey || "").trim(),
      diagnostics: null
    });
    const runAt = nowIso();
    const meta = {
      source: "agents.reddit.scrape",
      noNewInsights: true,
      newInsightCount: 0,
      currentReferenceCount: 0,
      newReferenceCount: 0,
      deltaFindingCount: 0,
      providerIssue,
      error: error?.message || "reddit_scraper_failed"
    };
    const persisted = persistRedditScrapeRun({
      workspaceId,
      nodeId,
      productId,
      status: "failed",
      runAt,
      nextRunAt: undefined,
      frequencyHours: Math.max(1, Number(req.body?.frequencyHours || 24)),
      findings: [],
      insights: [],
      insightsLibrary: [],
      recurringSubreddits: [],
      meta
    });
    res.status(500).json({ error: error?.message || "reddit_scraper_failed", providerIssue, runId: persisted.id, meta, insightMeta: meta });
  }
});

app.post("/agents/persona-needs-emotions", async (req, res) => {
  try {
    const workspaceId = String(req.body?.workspaceId || "").trim() || WORKSPACE_DEFAULT;
    const productId = String(req.body?.productId || "").trim() || "p-motion-canvas";
    const nodeId = String(req.body?.nodeId || "").trim() || "customer";
    const brandAnalysis = (req.body?.brandAnalysis || {}) as Record<string, unknown>;
    const findings = Array.isArray(req.body?.findings) ? req.body.findings : [];
    const result = await runPersonaNeedEmotion({ brandAnalysis: brandAnalysis as any, findings: findings as any });
    const updated = upsertCustomerBrainState({
      workspaceId,
      productId,
      nodeId: "customer",
      personaItems: Array.isArray(result.items) ? (result.items as Array<Record<string, unknown>>) : [],
      selectionMode: "manual",
      meta: { personaUpdatedAt: nowIso() }
    });
    res.json({ ...result, batchId: newId("persona"), updatedAt: updated.updatedAt });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "persona_needs_emotions_failed" });
  }
});

app.post("/agents/pne-framework", (req, res) => {
  try {
    const workspaceId = String(req.body?.workspaceId || "").trim() || WORKSPACE_DEFAULT;
    const productId = String(req.body?.productId || "").trim() || "p-motion-canvas";
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const limit = Number(req.body?.limit || 12);
    const result = runPneFramework({ items: items as any, limit: Number.isFinite(limit) ? limit : 12 });
    const updated = upsertCustomerBrainState({
      workspaceId,
      productId,
      nodeId: "customer",
      pneCombos: Array.isArray(result.pneCombos) ? (result.pneCombos as Array<Record<string, unknown>>) : [],
      selectionMode: "manual",
      meta: { pneUpdatedAt: nowIso() }
    });
    res.json({ ...result, batchId: newId("pne"), updatedAt: updated.updatedAt });
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

app.get("/workspaces/:workspaceId/brand-profile", (req, res) => {
  const hostedBase = resolveHostedApiBase(getDesktopSettings());
  if (hostedBase) {
    void proxyHostedRequest(req, res, hostedBase).catch((error: any) => {
      res.status(502).json({ error: error?.message || "Hosted backend proxy failed" });
    });
    return;
  }
  const workspaceId = String(req.params.workspaceId || WORKSPACE_DEFAULT).trim();
  const row = getWorkspaceBrandProfile(workspaceId);
  if (!row) {
    res.status(404).json({ error: "brand_profile_not_found" });
    return;
  }
  res.json(row);
});

app.put("/workspaces/:workspaceId/brand-profile", (req, res) => {
  const hostedBase = resolveHostedApiBase(getDesktopSettings());
  if (hostedBase) {
    void proxyHostedRequest(req, res, hostedBase).catch((error: any) => {
      res.status(502).json({ error: error?.message || "Hosted backend proxy failed" });
    });
    return;
  }
  const workspaceId = String(req.params.workspaceId || WORKSPACE_DEFAULT).trim();
  const existing = getWorkspaceBrandProfile(workspaceId);
  const brandUrl = String(req.body?.brandUrl || existing?.brandUrl || "").trim();
  if (!workspaceId) {
    res.status(400).json({ error: "workspace_id_required" });
    return;
  }
  if (!brandUrl) {
    res.status(400).json({ error: "brand_url_required" });
    return;
  }
  const existingAnalysis = isPlainObject(existing?.analysisJson) ? existing?.analysisJson : {};
  const incomingAnalysis = isPlainObject(req.body?.analysisJson) ? req.body.analysisJson : {};
  const saved = upsertWorkspaceBrandProfile(workspaceId, {
    brandUrl,
    companyName: String(req.body?.companyName || existing?.companyName || "").trim(),
    category: String(req.body?.category || existing?.category || "").trim(),
    targetAudience: String(req.body?.targetAudience || existing?.targetAudience || "").trim(),
    productsCatalog: Array.isArray(req.body?.productsCatalog)
      ? req.body.productsCatalog.map((value: unknown) => String(value || ""))
      : Array.isArray(existing?.productsCatalog)
        ? existing.productsCatalog
        : [],
    analysisJson: mergeBrandAnalysisJson(existingAnalysis, incomingAnalysis, {
      source: "brand_profile_manual_save",
      updatedAt: nowIso()
    })
  });
  persistBrandProfileRuns(workspaceId, saved, "brand_profile_manual_save", {
    triggeredBy: "brand_profile_manual_save"
  });
  res.json(saved);
});

app.post("/workspaces/:workspaceId/brand-profile/analyze", async (req, res) => {
  const hostedBase = resolveHostedApiBase(getDesktopSettings());
  if (hostedBase) {
    void proxyHostedRequest(req, res, hostedBase).catch((error: any) => {
      res.status(502).json({ error: error?.message || "Hosted backend proxy failed" });
    });
    return;
  }
  const workspaceId = String(req.params.workspaceId || WORKSPACE_DEFAULT).trim();
  const brandUrl = String(req.body?.brandUrl || "").trim();
  if (!workspaceId || !brandUrl) {
    res.status(400).json({ error: "workspace_id_and_brand_url_required" });
    return;
  }
  const inferred = await analyzeBrandProfile(brandUrl);
  const existing = getWorkspaceBrandProfile(workspaceId);
  const existingAnalysis = isPlainObject(existing?.analysisJson) ? existing?.analysisJson : {};
  const saved = upsertWorkspaceBrandProfile(workspaceId, {
    brandUrl: inferred.brandUrl,
    companyName: String(req.body?.companyName || inferred.companyName || "").trim(),
    category: String(req.body?.category || inferred.category || "").trim(),
    targetAudience: String(req.body?.targetAudience || inferred.targetAudience || "").trim(),
    productsCatalog: Array.isArray(req.body?.productsCatalog)
      ? req.body.productsCatalog.map((value: unknown) => String(value || ""))
      : inferred.productsCatalog,
    analysisJson: mergeBrandAnalysisJson(existingAnalysis, inferred.analysisJson as Record<string, unknown>, {
      source: "brand_profile_analyze",
      analyzedAt: nowIso(),
      notes: String(req.body?.notes || "").trim()
    })
  });
  persistBrandProfileRuns(workspaceId, saved, "brand_profile_analyze", {
    triggeredBy: "brand_profile_analyze",
    notes: String(req.body?.notes || "").trim()
  });
  res.json(saved);
});

app.get("/workspaces/:workspaceId/brand-profile/runs", (req, res) => {
  const hostedBase = resolveHostedApiBase(getDesktopSettings());
  if (hostedBase) {
    void proxyHostedRequest(req, res, hostedBase).catch((error: any) => {
      res.status(502).json({ error: error?.message || "Hosted backend proxy failed" });
    });
    return;
  }
  const workspaceId = String(req.params.workspaceId || WORKSPACE_DEFAULT).trim();
  const nodeIdValue = String(req.query?.nodeId || "").trim();
  const nodeId = nodeIdValue === "brand_kit" || nodeIdValue === "brand_guidelines" ? nodeIdValue : undefined;
  const limit = Number(req.query?.limit || 20);
  res.json(listBrandProfileRuns(workspaceId, nodeId, Number.isFinite(limit) ? limit : 20));
});

app.get("/workspaces/:workspaceId/reddit/runs", (req, res) => {
  const hostedBase = resolveHostedApiBase(getDesktopSettings());
  if (hostedBase) {
    void proxyHostedRequest(req, res, hostedBase).catch((error: any) => {
      res.status(502).json({ error: error?.message || "Hosted backend proxy failed" });
    });
    return;
  }
  const workspaceId = req.params.workspaceId || WORKSPACE_DEFAULT;
  const nodeId = String(req.query.nodeId || "").trim() || undefined;
  const limit = Number(req.query.limit || 20);
  res.json({
    workspaceId,
    nodeId: nodeId || null,
    runs: dedupeLocalRedditRunsForResponse(
      listRedditScrapeRuns(workspaceId, nodeId, Number.isFinite(limit) ? Math.max(limit * 3, limit) : 60)
    ).slice(0, Number.isFinite(limit) ? limit : 20)
  });
});

app.get("/workspaces/:workspaceId/reddit/runs/:runId", (req, res) => {
  const hostedBase = resolveHostedApiBase(getDesktopSettings());
  if (hostedBase) {
    void proxyHostedRequest(req, res, hostedBase).catch((error: any) => {
      res.status(502).json({ error: error?.message || "Hosted backend proxy failed" });
    });
    return;
  }
  const workspaceId = req.params.workspaceId || WORKSPACE_DEFAULT;
  const runId = String(req.params.runId || "").trim();
  const run = getRedditScrapeRunById(workspaceId, runId);
  if (!run) {
    res.status(404).json({ error: "reddit_run_not_found" });
    return;
  }
  res.json(run);
});

app.get("/workspaces/:workspaceId/reddit/insights-library", (req, res) => {
  const hostedBase = resolveHostedApiBase(getDesktopSettings());
  if (hostedBase) {
    void proxyHostedRequest(req, res, hostedBase).catch((error: any) => {
      res.status(502).json({ error: error?.message || "Hosted backend proxy failed" });
    });
    return;
  }
  const workspaceId = req.params.workspaceId || WORKSPACE_DEFAULT;
  const nodeId = String(req.query.nodeId || "").trim() || "reddit";
  const latest = readLatestRedditRunStmt.get(workspaceId, nodeId) as
    | {
        id: string;
        workspaceId: string;
        nodeId: string;
        productId: string | null;
        status: string;
        runAt: string;
        nextRunAt: string | null;
        frequencyHours: number;
        findingsJson: string;
        insightsJson: string;
        insightsLibraryJson: string;
        recurringSubredditsJson: string;
        metaJson: string;
      }
    | undefined;
  const run = latest ? parseRedditRunRow(latest) : null;
  res.json({
    workspaceId,
    nodeId,
    items: run ? run.insightsLibrary : [],
    runId: run ? run.id : null,
    updatedAt: run ? run.runAt : null
  });
});

app.get("/workspaces/:workspaceId/nodes/:nodeId/instructions", (req, res) => {
  const hostedBase = resolveHostedApiBase(getDesktopSettings());
  if (hostedBase) {
    void proxyHostedRequest(req, res, hostedBase).catch((error: any) => {
      res.status(502).json({ error: error?.message || "Hosted backend proxy failed" });
    });
    return;
  }
  const workspaceId = req.params.workspaceId || WORKSPACE_DEFAULT;
  const nodeId = String(req.params.nodeId || "").trim();
  const limit = Number(req.query.limit || 50);
  res.json({ records: listNodeInstructionMemory(workspaceId, nodeId, Number.isFinite(limit) ? limit : 50) });
});

app.post("/workspaces/:workspaceId/nodes/:nodeId/instructions", (req, res) => {
  const hostedBase = resolveHostedApiBase(getDesktopSettings());
  if (hostedBase) {
    void proxyHostedRequest(req, res, hostedBase).catch((error: any) => {
      res.status(502).json({ error: error?.message || "Hosted backend proxy failed" });
    });
    return;
  }
  const workspaceId = req.params.workspaceId || WORKSPACE_DEFAULT;
  const nodeId = String(req.params.nodeId || "").trim();
  const text = String(req.body?.text || "").trim();
  if (!text) {
    res.status(400).json({ error: "instruction_text_required" });
    return;
  }
  res.status(201).json(createNodeInstructionMemory({ workspaceId, nodeId, text }));
});

app.get("/workspaces/:workspaceId/customer-brain/pne-state", (req, res) => {
  const hostedBase = resolveHostedApiBase(getDesktopSettings());
  if (hostedBase) {
    void proxyHostedRequest(req, res, hostedBase).catch((error: any) => {
      res.status(502).json({ error: error?.message || "Hosted backend proxy failed" });
    });
    return;
  }
  const workspaceId = req.params.workspaceId || WORKSPACE_DEFAULT;
  const productId = String(req.query.productId || "").trim() || "p-motion-canvas";
  const state = getCustomerBrainState(workspaceId, productId, "customer");
  res.json({
    selectedInsights: state.selectedInsights,
    personaItems: state.personaItems,
    pneCombos: state.pneCombos,
    selectionMode: state.selectionMode,
    meta: state.meta,
    updatedAt: state.updatedAt
  });
});

app.post("/workspaces/:workspaceId/customer-brain/insights", (req, res) => {
  const hostedBase = resolveHostedApiBase(getDesktopSettings());
  if (hostedBase) {
    void proxyHostedRequest(req, res, hostedBase).catch((error: any) => {
      res.status(502).json({ error: error?.message || "Hosted backend proxy failed" });
    });
    return;
  }
  const workspaceId = req.params.workspaceId || WORKSPACE_DEFAULT;
  const productId = String(req.body?.productId || "").trim() || "p-motion-canvas";
  const selectedInsights = Array.isArray(req.body?.selectedInsights) ? req.body.selectedInsights : [];
  const state = upsertCustomerBrainState({
    workspaceId,
    productId,
    nodeId: "customer",
    selectedInsights: selectedInsights as Array<Record<string, unknown>>,
    selectionMode: "manual",
    meta: {
      selectedInsightsUpdatedAt: nowIso(),
      lastShortlistSource: "manual"
    }
  });
  res.json({ ok: true, updatedAt: state.updatedAt, selectedInsights: state.selectedInsights });
});

app.put("/workspaces/:workspaceId/customer-brain/persona-items", (req, res) => {
  const hostedBase = resolveHostedApiBase(getDesktopSettings());
  if (hostedBase) {
    void proxyHostedRequest(req, res, hostedBase).catch((error: any) => {
      res.status(502).json({ error: error?.message || "Hosted backend proxy failed" });
    });
    return;
  }
  const workspaceId = req.params.workspaceId || WORKSPACE_DEFAULT;
  const productId = String(req.body?.productId || "").trim() || "p-motion-canvas";
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const state = upsertCustomerBrainState({
    workspaceId,
    productId,
    nodeId: "customer",
    personaItems: items as Array<Record<string, unknown>>,
    selectionMode: "manual",
    meta: { personaUpdatedAt: nowIso() }
  });
  res.json({ items: state.personaItems, updatedAt: state.updatedAt, batchId: newId("persona") });
});

app.put("/workspaces/:workspaceId/customer-brain/pne-combos", (req, res) => {
  const hostedBase = resolveHostedApiBase(getDesktopSettings());
  if (hostedBase) {
    void proxyHostedRequest(req, res, hostedBase).catch((error: any) => {
      res.status(502).json({ error: error?.message || "Hosted backend proxy failed" });
    });
    return;
  }
  const workspaceId = req.params.workspaceId || WORKSPACE_DEFAULT;
  const productId = String(req.body?.productId || "").trim() || "p-motion-canvas";
  const pneCombos = Array.isArray(req.body?.pneCombos) ? req.body.pneCombos : [];
  const normalizedPneCombos = withNormalizedPrimaryPneRows(pneCombos as Array<Record<string, unknown>>);
  const activePneId = deriveActivePneIdFromRows(normalizedPneCombos);
  const state = upsertCustomerBrainState({
    workspaceId,
    productId,
    nodeId: "customer",
    pneCombos: normalizedPneCombos,
    selectionMode: "manual",
    meta: { pneUpdatedAt: nowIso(), activePneId }
  });
  res.json({ pneCombos: state.pneCombos, updatedAt: state.updatedAt, batchId: newId("pne") });
});

app.get("/workspaces/:workspaceId/presentation/brief-state", (req, res) => {
  const hostedBase = resolveHostedApiBase(getDesktopSettings());
  if (hostedBase) {
    void proxyHostedRequest(req, res, hostedBase).catch((error: any) => {
      res.status(502).json({ error: error?.message || "Hosted backend proxy failed" });
    });
    return;
  }
  const workspaceId = String(req.params.workspaceId || WORKSPACE_DEFAULT).trim();
  const productId = String(req.query.productId || "").trim() || undefined;
  if (!workspaceId) {
    res.status(400).json({ error: "workspace_id_required" });
    return;
  }
  res.json(buildPresentationBriefState(workspaceId, productId));
});

app.put("/workspaces/:workspaceId/presentation/briefs", (req, res) => {
  const hostedBase = resolveHostedApiBase(getDesktopSettings());
  if (hostedBase) {
    void proxyHostedRequest(req, res, hostedBase).catch((error: any) => {
      res.status(502).json({ error: error?.message || "Hosted backend proxy failed" });
    });
    return;
  }
  try {
    const workspaceId = String(req.params.workspaceId || WORKSPACE_DEFAULT).trim();
    const nodeId = String(req.body?.nodeId || "synth").trim();
    const productId = String(req.body?.productId || "").trim() || undefined;
    const briefRaw = isPlainObject(req.body?.brief) ? (req.body.brief as Record<string, unknown>) : null;
    if (!workspaceId) {
      res.status(400).json({ error: "workspace_id_required" });
      return;
    }
    if (!briefRaw) {
      res.status(400).json({ error: "brief_required" });
      return;
    }
    const now = nowIso();
    const existingBriefs = listBriefLibraryRecords(workspaceId, 80, productId);
    const revision = buildNextPresentationArtifactRevision(existingBriefs, briefRaw, "brief_manual");
    const stringList = (value: unknown, limit = 12) =>
      Array.isArray(value)
        ? Array.from(new Set(value.map((entry) => String(entry || "").trim()).filter(Boolean))).slice(0, limit)
        : [];
    const references = Array.isArray(briefRaw.references)
      ? briefRaw.references.filter((entry) => entry && typeof entry === "object").slice(0, 10)
      : [];
    const sourceSummary = isPlainObject(briefRaw.sourceSummary) ? briefRaw.sourceSummary : {};
    const sourceRefs = isPlainObject(briefRaw.sourceRefs) ? briefRaw.sourceRefs : {};
    const successMetrics = isPlainObject(briefRaw.successMetrics) ? briefRaw.successMetrics : {};
    const brandContext = isPlainObject(briefRaw.brandContext) ? briefRaw.brandContext : {};
    const customerSummary = isPlainObject(briefRaw.customerSummary) ? briefRaw.customerSummary : {};
    const sanitizedBrief = {
      id: revision.id,
      rootId: revision.rootId,
      previousId: revision.previousId || undefined,
      code: String(briefRaw.code || `BRF-MANUAL-${String(Date.now()).slice(-6)}`).trim(),
      version: revision.version,
      title: String(briefRaw.title || "Strategic Creative Brief").trim(),
      category: String(briefRaw.category || "").trim(),
      objective: String(briefRaw.objective || "Create a production-ready performance marketing direction").trim(),
      audience: String(briefRaw.audience || "").trim(),
      angle: String(briefRaw.angle || "").trim(),
      insightCore: String(briefRaw.insightCore || "").trim(),
      targetMoment: String(briefRaw.targetMoment || "").trim(),
      hook: String(briefRaw.hook || "").trim(),
      hookOptions: stringList(briefRaw.hookOptions, 8),
      audienceFraming: String(briefRaw.audienceFraming || "").trim(),
      offerFrame: String(briefRaw.offerFrame || "").trim(),
      proofPoints: stringList(briefRaw.proofPoints, 8),
      objections: stringList(briefRaw.objections, 8),
      ctas: stringList(briefRaw.ctas, 8),
      formatSuggestions: stringList(briefRaw.formatSuggestions, 8),
      tone: String(briefRaw.tone || "").trim(),
      successMetrics: {
        hookHoldTarget: String(successMetrics.hookHoldTarget || ">4s").trim(),
        ctrTarget: String(successMetrics.ctrTarget || "1.5%+").trim(),
        cvrTarget: String(successMetrics.cvrTarget || "2.5%+").trim(),
        roasTarget: String(successMetrics.roasTarget || "3.0x+").trim()
      },
      brandContext: {
        companyName: String(brandContext.companyName || "").trim(),
        category: String(brandContext.category || "").trim(),
        targetAudience: String(brandContext.targetAudience || "").trim(),
        productFocus: String(brandContext.productFocus || "").trim(),
        productsCatalog: stringList(brandContext.productsCatalog, 12),
        valueProps: stringList(brandContext.valueProps, 12),
        messagingPillars: stringList(brandContext.messagingPillars, 12),
        toneTraits: stringList(brandContext.toneTraits, 12),
        proofPoints: stringList(brandContext.proofPoints, 12),
        visualSignals: stringList(brandContext.visualSignals, 12),
        positioningSummary: String(brandContext.positioningSummary || "").trim()
      },
      customerSummary: {
        leadPersona: String(customerSummary.leadPersona || "").trim(),
        leadNeed: String(customerSummary.leadNeed || "").trim(),
        leadEmotion: String(customerSummary.leadEmotion || "").trim(),
        leadAngle: String(customerSummary.leadAngle || "").trim(),
        primaryPneId: String(customerSummary.primaryPneId || "").trim(),
        supportingInsightCount: Number(customerSummary.supportingInsightCount || 0) || 0,
        supportingReferenceCount: Number(customerSummary.supportingReferenceCount || 0) || 0
      },
      sourceSummary: {
        selectedInsightCount: Number(sourceSummary.selectedInsightCount || 0) || 0,
        mentionCount: Number(sourceSummary.mentionCount || 0) || 0,
        uniqueUserCount: Number(sourceSummary.uniqueUserCount || 0) || 0,
        personaCount: Number(sourceSummary.personaCount || 0) || 0,
        pneCount: Number(sourceSummary.pneCount || 0) || 0,
        activePneId: String(sourceSummary.activePneId || "").trim()
      },
      sourceRefs: {
        selectedInsightIds: stringList(sourceRefs.selectedInsightIds, 24),
        personaIds: stringList(sourceRefs.personaIds, 24),
        pneIds: stringList(sourceRefs.pneIds, 24)
      },
      references,
      createdAt: revision.createdAt,
      updatedAt: now,
      productId
    };
    const storedRecord = addDataStoreRecord("db_briefs_library", workspaceId, nodeId, productId, {
      ...sanitizedBrief,
      storedAt: now
    });
    res.json({ brief: sanitizedBrief, storedCount: 1, records: [storedRecord], savedAt: now });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "brief_save_failed" });
  }
});

app.put("/workspaces/:workspaceId/presentation/storyboards", (req, res) => {
  const hostedBase = resolveHostedApiBase(getDesktopSettings());
  if (hostedBase) {
    void proxyHostedRequest(req, res, hostedBase).catch((error: any) => {
      res.status(502).json({ error: error?.message || "Hosted backend proxy failed" });
    });
    return;
  }
  try {
    const workspaceId = String(req.params.workspaceId || WORKSPACE_DEFAULT).trim();
    const nodeId = String(req.body?.nodeId || "storyboard").trim();
    const productId = String(req.body?.productId || "").trim() || undefined;
    const storyboardRaw = isPlainObject(req.body?.storyboard) ? (req.body.storyboard as Record<string, unknown>) : null;
    if (!workspaceId) {
      res.status(400).json({ error: "workspace_id_required" });
      return;
    }
    if (!storyboardRaw) {
      res.status(400).json({ error: "storyboard_required" });
      return;
    }
    const now = nowIso();
    const existingStoryboards = listStoryboardLibraryRecords(workspaceId, 80, productId);
    const revision = buildNextPresentationArtifactRevision(existingStoryboards, storyboardRaw, "storyboard_manual");
    const stringList = (value: unknown, limit = 12) =>
      Array.isArray(value)
        ? Array.from(new Set(value.map((entry) => String(entry || "").trim()).filter(Boolean))).slice(0, limit)
        : [];
    const references = Array.isArray(storyboardRaw.references)
      ? storyboardRaw.references.filter((entry) => entry && typeof entry === "object").slice(0, 10)
      : [];
    const sourceSummary = isPlainObject(storyboardRaw.sourceSummary) ? storyboardRaw.sourceSummary : {};
    const brandContext = isPlainObject(storyboardRaw.brandContext) ? storyboardRaw.brandContext : {};
    const customerSummary = isPlainObject(storyboardRaw.customerSummary) ? storyboardRaw.customerSummary : {};
    const sourceRefs = isPlainObject(storyboardRaw.sourceRefs) ? storyboardRaw.sourceRefs : {};
    const generationReady = isPlainObject(storyboardRaw.generationReady) ? storyboardRaw.generationReady : {};
    const audioDirection = isPlainObject(storyboardRaw.audioDirection) ? storyboardRaw.audioDirection : {};
    const scriptRaw = isPlainObject(storyboardRaw.script) ? storyboardRaw.script : {};
    const scenes = Array.isArray(storyboardRaw.scenes)
      ? storyboardRaw.scenes
          .filter((entry) => entry && typeof entry === "object")
          .map((entry: any, idx) => ({
            index: Number(entry.index || idx + 1) || idx + 1,
            beat: String(entry.beat || entry.shotIntent || `Scene ${idx + 1}`).trim(),
            durationSec: Number(entry.durationSec || 0) || 0,
            shotIntent: String(entry.shotIntent || entry.beat || `Scene ${idx + 1}`).trim(),
            visualCue: String(entry.visualCue || "").trim(),
            overlay: String(entry.overlay || "").trim(),
            voiceoverLine: String(entry.voiceoverLine || "").trim(),
            transition: String(entry.transition || "").trim()
          }))
          .slice(0, 8)
      : [];
    const fullVoiceover = String(scriptRaw.fullVoiceover || "").trim();
    const voiceoverParts = fullVoiceover
      ? fullVoiceover.split(/(?<=[.!?])\s+/).map((line) => line.trim()).filter(Boolean)
      : [];
    const sanitizedStoryboard = {
      id: revision.id,
      rootId: revision.rootId,
      previousId: revision.previousId || undefined,
      code: String(storyboardRaw.code || `SB-MANUAL-${String(Date.now()).slice(-6)}`).trim(),
      version: revision.version,
      briefId: String(storyboardRaw.briefId || "").trim(),
      briefCode: String(storyboardRaw.briefCode || "").trim(),
      title: String(storyboardRaw.title || "Storyboard + Script").trim(),
      format: String(storyboardRaw.format || "").trim(),
      audience: String(storyboardRaw.audience || "").trim(),
      angle: String(storyboardRaw.angle || "").trim(),
      objective: String(storyboardRaw.objective || "Translate the brief into a generation-ready scene plan").trim(),
      targetMoment: String(storyboardRaw.targetMoment || "").trim(),
      hook: String(storyboardRaw.hook || scriptRaw.opening || "").trim(),
      pacing: String(storyboardRaw.pacing || "").trim(),
      totalDurationSec: Number(storyboardRaw.totalDurationSec || 0) || scenes.reduce((sum, scene) => sum + (Number(scene.durationSec || 0) || 0), 0),
      scenes,
      script: {
        opening: String(scriptRaw.opening || voiceoverParts[0] || "").trim(),
        body: Array.isArray(scriptRaw.body)
          ? scriptRaw.body.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 8)
          : voiceoverParts.slice(1, -1),
        closing: String(scriptRaw.closing || voiceoverParts[voiceoverParts.length - 1] || "").trim(),
        fullVoiceover,
        overlays: Array.isArray(scriptRaw.overlays)
          ? scriptRaw.overlays.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 8)
          : scenes.map((scene) => scene.overlay).filter(Boolean).slice(0, 8)
      },
      audioDirection: {
        voiceoverTone: String(audioDirection.voiceoverTone || "").trim(),
        musicMood: String(audioDirection.musicMood || "").trim(),
        sfxNotes: stringList(audioDirection.sfxNotes, 8)
      },
      generationReady: {
        templateHint: String(generationReady.templateHint || storyboardRaw.format || "").trim(),
        promptSummary: String(generationReady.promptSummary || "").trim(),
        scenePlan: String(generationReady.scenePlan || "").trim()
      },
      brandContext: {
        companyName: String(brandContext.companyName || "").trim(),
        category: String(brandContext.category || "").trim(),
        targetAudience: String(brandContext.targetAudience || "").trim(),
        productFocus: String(brandContext.productFocus || "").trim(),
        productsCatalog: stringList(brandContext.productsCatalog, 12),
        valueProps: stringList(brandContext.valueProps, 12),
        messagingPillars: stringList(brandContext.messagingPillars, 12),
        toneTraits: stringList(brandContext.toneTraits, 12),
        proofPoints: stringList(brandContext.proofPoints, 12),
        visualSignals: stringList(brandContext.visualSignals, 12),
        positioningSummary: String(brandContext.positioningSummary || "").trim()
      },
      customerSummary: {
        leadPersona: String(customerSummary.leadPersona || "").trim(),
        leadNeed: String(customerSummary.leadNeed || "").trim(),
        leadEmotion: String(customerSummary.leadEmotion || "").trim(),
        leadAngle: String(customerSummary.leadAngle || "").trim(),
        primaryPneId: String(customerSummary.primaryPneId || "").trim()
      },
      sourceSummary: {
        briefCode: String(sourceSummary.briefCode || storyboardRaw.briefCode || "").trim(),
        proofPointCount: Number(sourceSummary.proofPointCount || 0) || 0,
        objectionCount: Number(sourceSummary.objectionCount || 0) || 0,
        referenceCount: Number(sourceSummary.referenceCount || references.length) || 0,
        activePneId: String(sourceSummary.activePneId || "").trim()
      },
      sourceRefs: {
        selectedInsightIds: stringList(sourceRefs.selectedInsightIds, 24),
        personaIds: stringList(sourceRefs.personaIds, 24),
        pneIds: stringList(sourceRefs.pneIds, 24)
      },
      references,
      createdAt: revision.createdAt,
      updatedAt: now,
      productId
    };
    const storyboardRecord = addDataStoreRecord("db_storyboard_library", workspaceId, nodeId, productId, {
      ...sanitizedStoryboard,
      storedAt: now
    });
    const scriptRecord = addDataStoreRecord("db_scripts_library", workspaceId, nodeId, productId, {
      storyboardId: sanitizedStoryboard.id,
      storyboardCode: sanitizedStoryboard.code,
      briefId: sanitizedStoryboard.briefId,
      briefCode: sanitizedStoryboard.briefCode,
      title: sanitizedStoryboard.title,
      format: sanitizedStoryboard.format,
      script: sanitizedStoryboard.script,
      audioDirection: sanitizedStoryboard.audioDirection,
      createdAt: sanitizedStoryboard.createdAt,
      updatedAt: now,
      storedAt: now
    });
    res.json({
      storyboard: sanitizedStoryboard,
      storedStoryboardCount: 1,
      storedScriptCount: 1,
      storyboardRecords: [storyboardRecord],
      scriptRecords: [scriptRecord],
      savedAt: now
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "storyboard_save_failed" });
  }
});

app.get("/workspaces/:workspaceId/presentation/storyboard-state", (req, res) => {
  const hostedBase = resolveHostedApiBase(getDesktopSettings());
  if (hostedBase) {
    void proxyHostedRequest(req, res, hostedBase).catch((error: any) => {
      res.status(502).json({ error: error?.message || "Hosted backend proxy failed" });
    });
    return;
  }
  const workspaceId = String(req.params.workspaceId || WORKSPACE_DEFAULT).trim();
  const productId = String(req.query.productId || "").trim() || undefined;
  if (!workspaceId) {
    res.status(400).json({ error: "workspace_id_required" });
    return;
  }
  res.json(buildPresentationStoryboardState(workspaceId, productId));
});

app.get("/workspaces/:workspaceId/generation/strategy-packet", (req, res) => {
  const hostedBase = resolveHostedApiBase(getDesktopSettings());
  if (hostedBase) {
    void proxyHostedRequest(req, res, hostedBase).catch((error: any) => {
      res.status(502).json({ error: error?.message || "Hosted backend proxy failed" });
    });
    return;
  }
  const workspaceId = String(req.params.workspaceId || WORKSPACE_DEFAULT).trim();
  const productId = String(req.query.productId || "").trim() || undefined;
  if (!workspaceId) {
    res.status(400).json({ error: "workspace_id_required" });
    return;
  }
  const packet = buildGenerationStrategyPacket(workspaceId, productId);
  res.json({
    ...packet,
    structuredPrompt: compileStructuredGenerationPrompt(packet)
  });
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
