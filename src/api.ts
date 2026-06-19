import type { CanvasDocument, WorkspaceSnapshot, WorkspaceEvent } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8790";

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
