export type CanvasNodeKind =
  | "agent"
  | "source"
  | "brief"
  | "generation.image"
  | "generation.video"
  | "generation.audio"
  | "generation.music"
  | "generation.template";

export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface CanvasNode {
  id: string;
  kind: CanvasNodeKind;
  x: number;
  y: number;
  title: string;
  subtitle?: string;
  config?: {
    workflowRef?: string;
    templateId?: string;
    inputs?: Record<string, unknown>;
    params?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
  };
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

export interface GenerationRun {
  id: string;
  workspaceId: string;
  productId: string;
  status: RunStatus;
  startedAt: string;
  completedAt?: string | null;
  errorMessage?: string | null;
}

export interface GenerationRunStep {
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
}

export interface GenerationArtifact {
  id: string;
  runId: string;
  stepId: string;
  type: "image" | "video" | "audio";
  uri: string;
  previewUri: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface GenerationRunDetail {
  run: GenerationRun;
  steps: GenerationRunStep[];
  artifacts: GenerationArtifact[];
}

export type WorkspaceEvent =
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
      type: "generation.job.updated";
      workspaceId: string;
      productId: string;
      runId: string;
      nodeId: string;
      job: {
        providerJobId: string;
        status: "queued" | "running" | "completed" | "failed";
        progress: number;
        errorCode?: string;
        errorMessage?: string;
      };
      updatedAt: string;
    };
