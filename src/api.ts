import type { CanvasDocument, GenerationRun, GenerationRunDetail, WorkspaceSnapshot, WorkspaceEvent } from "./types";

function resolveApiBase() {
  if (typeof window !== "undefined") {
    const fromRuntime = window.localStorage.getItem("openflow.runtimeApiBase");
    if (fromRuntime) return fromRuntime.replace(/\/+$/, "");
  }
  return (import.meta.env.VITE_API_BASE || "http://localhost:8790").replace(/\/+$/, "");
}

const API_BASE = resolveApiBase();

export async function getSnapshot(workspaceId: string): Promise<WorkspaceSnapshot> {
  const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/snapshot`);
  if (!res.ok) throw new Error("Failed to load snapshot");
  return res.json();
}

export async function saveCanvas(workspaceId: string, productId: string, doc: CanvasDocument): Promise<CanvasDocument> {
  const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/products/${productId}/canvas`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(doc)
  });
  if (!res.ok) throw new Error("Failed to save canvas");
  return res.json();
}

export async function startRun(
  workspaceId: string,
  productId: string,
  options?: { nodeIds?: string[] }
): Promise<{ runId: string; run: GenerationRun }> {
  const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/products/${productId}/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options || {})
  });
  if (!res.ok) throw new Error("Failed to start run");
  return res.json();
}

export async function listRuns(workspaceId: string, productId: string): Promise<GenerationRun[]> {
  const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/products/${productId}/runs`);
  if (!res.ok) throw new Error("Failed to list runs");
  return res.json();
}

export async function getRunDetail(
  workspaceId: string,
  productId: string,
  runId: string
): Promise<GenerationRunDetail> {
  const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/products/${productId}/runs/${runId}`);
  if (!res.ok) throw new Error("Failed to load run detail");
  return res.json();
}

export async function cancelRun(workspaceId: string, productId: string, runId: string): Promise<GenerationRun> {
  const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/products/${productId}/runs/${runId}/cancel`, {
    method: "POST"
  });
  if (!res.ok) throw new Error("Failed to cancel run");
  return res.json();
}

export function subscribeWorkspace(workspaceId: string, onEvent: (event: WorkspaceEvent) => void): () => void {
  const wsUrl = API_BASE.replace(/^http/, "ws") + `/ws?workspaceId=${workspaceId}`;
  const ws = new WebSocket(wsUrl);
  ws.onmessage = (msg) => {
    try {
      onEvent(JSON.parse(msg.data));
    } catch {
      // ignore malformed events in scaffold mode
    }
  };
  return () => ws.close();
}
