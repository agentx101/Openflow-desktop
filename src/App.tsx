import { useEffect, useMemo, useState } from "react";
import { getSnapshot, saveCanvas, subscribeWorkspace } from "./api";
import type { CanvasDocument, CanvasNode, WorkspaceSnapshot, WorkspaceEvent } from "./types";

const WORKSPACE_ID = "default-workspace";

function edgePath(from: CanvasNode, to: CanvasNode) {
  const x1 = from.x + 220;
  const y1 = from.y + 55;
  const x2 = to.x;
  const y2 = to.y + 55;
  const cx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;
}

export default function App() {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [activeProductId, setActiveProductId] = useState<string>("");

  useEffect(() => {
    getSnapshot(WORKSPACE_ID).then((data) => {
      setSnapshot(data);
      setActiveProductId(data.products[0]?.id || "");
    });
    const unsubscribe = subscribeWorkspace(WORKSPACE_ID, (event: WorkspaceEvent) => {
      setSnapshot((prev) => {
        if (!prev) return prev;
        if (event.type === "canvas.updated") {
          return { ...prev, documents: { ...prev.documents, [event.productId]: event.doc } };
        }
        if (event.type === "product.created") {
          return { ...prev, products: [...prev.products, event.product] };
        }
        return prev;
      });
    });
    return unsubscribe;
  }, []);

  const activeDoc = useMemo<CanvasDocument | null>(() => {
    if (!snapshot || !activeProductId) return null;
    return snapshot.documents[activeProductId] || null;
  }, [snapshot, activeProductId]);

  async function nudgeNode(nodeId: string) {
    if (!activeDoc) return;
    const nodes = activeDoc.nodes.map((node) => (node.id === nodeId ? { ...node, x: node.x + 12 } : node));
    const updated = { ...activeDoc, nodes };
    setSnapshot((prev) => (prev ? { ...prev, documents: { ...prev.documents, [activeDoc.productId]: updated } } : prev));
    await saveCanvas(WORKSPACE_ID, activeDoc.productId, updated);
  }

  if (!snapshot || !activeDoc) {
    return <div className="boot">Loading canvas workspace...</div>;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-title">Projects</div>
        {snapshot.folders.map((folder) => (
          <div className="folder" key={folder.id}>
            <div className="folder-name">{folder.name}</div>
            <ul className="products">
              {snapshot.products
                .filter((product) => product.folderId === folder.id)
                .map((product) => (
                  <li key={product.id}>
                    <button
                      className={product.id === activeProductId ? "product active" : "product"}
                      onClick={() => setActiveProductId(product.id)}
                    >
                      {product.name}
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </aside>

      <main className="workspace">
        <header className="toolbar">
          <div className="toolbar-title">Performance Marketing Canvas</div>
          <div className="toolbar-subtitle">Desktop shell (Tauri): same product canvas and cloud sync</div>
        </header>

        <section className="canvas">
          <svg className="edges" width="1600" height="900">
            {activeDoc.edges.map((edge) => {
              const from = activeDoc.nodes.find((n) => n.id === edge.from);
              const to = activeDoc.nodes.find((n) => n.id === edge.to);
              if (!from || !to) return null;
              return <path key={edge.id} d={edgePath(from, to)} />;
            })}
          </svg>

          {activeDoc.nodes.map((node) => (
            <article
              key={node.id}
              className={`node ${node.kind}`}
              style={{ left: `${node.x}px`, top: `${node.y}px` }}
              onDoubleClick={() => nudgeNode(node.id)}
              title="Double click to simulate update + sync"
            >
              <h3>{node.title}</h3>
              <p>{node.subtitle || "Canvas node"}</p>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
