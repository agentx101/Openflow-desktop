import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";

type CanvasNodeKind = "agent" | "source" | "brief";
type CanvasNode = { id: string; kind: CanvasNodeKind; x: number; y: number; title: string; subtitle?: string };
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
type WorkspaceEvent =
  | { type: "canvas.updated"; workspaceId: string; productId: string; doc: CanvasDocument; updatedAt: string }
  | { type: "product.created"; workspaceId: string; folderId: string; product: Product; updatedAt: string };

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

function nowIso() {
  return new Date().toISOString();
}

function seedDocument(productId: string): CanvasDocument {
  return {
    productId,
    updatedAt: nowIso(),
    nodes: [
      { id: "n-source", kind: "source", x: 120, y: 140, title: "Data Source", subtitle: "Research signals" },
      { id: "n-agent", kind: "agent", x: 420, y: 120, title: "Agent Chat", subtitle: "Hook ideation" },
      { id: "n-brief", kind: "brief", x: 760, y: 120, title: "Strategic Brief", subtitle: "Exploration sprint" }
    ],
    edges: [
      { id: "e-1", from: "n-source", to: "n-agent" },
      { id: "e-2", from: "n-agent", to: "n-brief" }
    ]
  };
}

function ensureSeed(workspaceId: string) {
  const row = countFolders.get(workspaceId) as { count: number };
  if (row.count > 0) return;
  const folders = [
    { id: "f-research", workspaceId, name: "Research Sprints" },
    { id: "f-campaigns", workspaceId, name: "Campaign Launches" }
  ];
  const products = [
    { id: "p-motion-canvas", folderId: "f-research", name: "Motion Canvas" },
    { id: "p-openflow-growth", folderId: "f-campaigns", name: "Openflow Growth" }
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

function getSnapshot(workspaceId: string): WorkspaceSnapshot {
  ensureSeed(workspaceId);
  const folders = readFolders.all(workspaceId) as ProjectFolder[];
  const products = readProducts.all(workspaceId) as Product[];
  const docs = readDocs.all(workspaceId) as Array<{ productId: string; docJson: string }>;
  const documents: Record<string, CanvasDocument> = {};
  for (const row of docs) documents[row.productId] = JSON.parse(row.docJson) as CanvasDocument;
  return { workspaceId, folders, products, documents };
}

function putCanvas(workspaceId: string, productId: string, doc: CanvasDocument): CanvasDocument {
  ensureSeed(workspaceId);
  const normalized: CanvasDocument = { ...doc, productId, updatedAt: nowIso() };
  upsertDoc.run(productId, workspaceId, JSON.stringify(normalized), normalized.updatedAt);
  return normalized;
}

function addProduct(workspaceId: string, folderId: string, name: string): Product {
  ensureSeed(workspaceId);
  const product: Product = { id: `p-${Date.now()}`, folderId, name };
  insertProduct.run(product.id, workspaceId, folderId, name);
  const blank: CanvasDocument = { productId: product.id, updatedAt: nowIso(), nodes: [], edges: [] };
  upsertDoc.run(product.id, workspaceId, JSON.stringify(blank), blank.updatedAt);
  return product;
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

app.get("/health", (_req, res) => res.json({ ok: true, local: true, db: DB_PATH }));

app.get("/workspaces/:workspaceId/snapshot", (req, res) => {
  const workspaceId = req.params.workspaceId || WORKSPACE_DEFAULT;
  res.json(getSnapshot(workspaceId));
});

app.post("/workspaces/:workspaceId/folders/:folderId/products", (req, res) => {
  const workspaceId = req.params.workspaceId || WORKSPACE_DEFAULT;
  const folderId = req.params.folderId;
  const name = String(req.body?.name || "Untitled Product");
  const product = addProduct(workspaceId, folderId, name);
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
  const doc = putCanvas(workspaceId, productId, req.body as CanvasDocument);
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
