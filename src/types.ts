export type CanvasNodeKind = "agent" | "source" | "brief";

export interface CanvasNode {
  id: string;
  kind: CanvasNodeKind;
  x: number;
  y: number;
  title: string;
  subtitle?: string;
}

export interface CanvasEdge {
  id: string;
  from: string;
  to: string;
}

export interface CanvasDocument {
  productId: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  updatedAt: string;
}

export interface Product {
  id: string;
  folderId: string;
  name: string;
}

export interface ProjectFolder {
  id: string;
  workspaceId: string;
  name: string;
}

export interface WorkspaceSnapshot {
  workspaceId: string;
  folders: ProjectFolder[];
  products: Product[];
  documents: Record<string, CanvasDocument>;
}

export type WorkspaceEvent =
  | { type: "canvas.updated"; workspaceId: string; productId: string; doc: CanvasDocument; updatedAt: string }
  | { type: "product.created"; workspaceId: string; folderId: string; product: Product; updatedAt: string };
