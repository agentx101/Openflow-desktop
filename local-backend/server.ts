import cors from "cors";
import express from "express";
import { WebSocketServer } from "ws";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";

type CanvasNodeKind =
  | "agent"
  | "source"
  | "brief"
  | "generation.image"
  | "generation.video"
  | "generation.template";
type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
type GenerationJobStatus = "queued" | "running" | "completed" | "failed";

type GenerationNodeConfig = {
  workflowRef: string;
  templateId?: string;
  inputs?: Record<string, unknown>;
  params?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
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
  type: "image" | "video";
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

const mockJobs = new Map<string, JobState>();
const runCancellationMap = new Map<string, { cancelled: boolean }>();

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
);`);

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

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      { id: "n-brief", kind: "brief", x: 930, y: 120, title: "Output Review", subtitle: "Compare outputs" }
    ],
    edges: [
      { id: "e-1", from: "n-source", to: "n-template" },
      { id: "e-2", from: "n-template", to: "n-image" },
      { id: "e-3", from: "n-template", to: "n-video" },
      { id: "e-4", from: "n-image", to: "n-brief" },
      { id: "e-5", from: "n-video", to: "n-brief" }
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

function addArtifact(runId: string, stepId: string, type: "image" | "video", uri: string, previewUri: string, metadata: Record<string, unknown>) {
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

function extractGenerationNodes(doc: CanvasDocument): CanvasNode[] {
  return doc.nodes.filter(
    (node) =>
      node.kind === "generation.image" || node.kind === "generation.video" || node.kind === "generation.template"
  );
}

function selectGenerationNodes(doc: CanvasDocument, nodeIds?: string[]): CanvasNode[] {
  const generationNodes = extractGenerationNodes(doc);
  if (!nodeIds || nodeIds.length === 0) {
    return generationNodes;
  }
  const selected = new Set(nodeIds);
  const hasRenderNode = generationNodes.some(
    (node) => selected.has(node.id) && (node.kind === "generation.image" || node.kind === "generation.video")
  );
  return generationNodes.filter((node) => selected.has(node.id) || (hasRenderNode && node.kind === "generation.template"));
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

async function runGenerationNode(workspaceId: string, productId: string, runId: string, node: CanvasNode) {
  const step = createRunStep(runId, node.id, node.kind);
  const startedAt = Date.now();
  let updated = updateRunStep(step.id, { status: "running", startedAt: nowIso() });
  emitStepUpdate(workspaceId, productId, runId, updated);

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

  const workflowRef = node.config?.workflowRef || (node.kind === "generation.video" ? "comfy_video_ad_v1" : "comfy_image_ad_v1");
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

  const generationNodes = selectGenerationNodes(doc, nodeIds);
  try {
    for (const node of generationNodes) {
      if (isCancelled(runId)) {
        updateRunStatus(runId, "cancelled");
        break;
      }
      await runGenerationNode(workspaceId, productId, runId, node);
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

app.get("/workspaces/:workspaceId/snapshot", (req, res) => {
  const workspaceId = req.params.workspaceId || WORKSPACE_DEFAULT;
  res.json(getWorkspace(workspaceId));
});

app.post("/workspaces/:workspaceId/folders/:folderId/products", (req, res) => {
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
  const workspaceId = req.params.workspaceId || WORKSPACE_DEFAULT;
  const productId = req.params.productId;
  res.json(listRuns(workspaceId, productId));
});

app.get("/workspaces/:workspaceId/products/:productId/runs/:runId", (req, res) => {
  const detail = getRunDetail(req.params.runId);
  if (!detail) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  res.json(detail);
});

app.post("/workspaces/:workspaceId/products/:productId/runs/:runId/cancel", (req, res) => {
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
