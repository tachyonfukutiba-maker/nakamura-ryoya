import React, { useState, useEffect, useCallback, useMemo } from "react"
import ReactFlow, {
  ReactFlowProvider,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  addEdge,
  // ★ ここから型定義用として type を追加
  type Node,
  type Edge,
  type Connection,
  type EdgeProps,
  // ★ ここまで
  MarkerType,
  useReactFlow,
  Handle,
  Position,
  getBezierPath,
} from "reactflow"
import "reactflow/dist/style.css"
import dagre from "dagre"
import { toPng } from "html-to-image"

// ------------------------------------------------------------------
// 1. 型定義 & 定数
// ------------------------------------------------------------------
type NodeType = "definition" | "theorem"

interface NodeData {
  label: string
  type: NodeType
  description?: string
}

interface EdgeData {
  label: string 
  type: "none" | "generalization" | "extension" | "example" | "proof"
  color: string
  directed: boolean
  animated: boolean
}

const NODE_COLORS = {
  definition: { bg: "#e8f5e9", border: "#2e7d32", text: "#1b5e20" },
  theorem: { bg: "#e3f2fd", border: "#0288d1", text: "#0d47a1" },
}

// 初期表示用のウェルカムデータ
const welcomeNodes: Node<NodeData>[] = [
  {
    id: "welcome-1",
    type: "mathNode",
    position: { x: 100, y: 150 },
    data: { label: "数式マップへようこそ", type: "definition", description: "これは数学の繋がりを可視化するツールです。" },
    style: { overflow: "visible" }
  },
  {
    id: "welcome-2",
    type: "mathNode",
    position: { x: 450, y: 150 },
    data: { label: "定理の発展", type: "theorem", description: "定義から定理へと矢印を伸ばして、知識の構造を作れます。" },
    style: { overflow: "visible" }
  }
]

const welcomeEdges: Edge<EdgeData>[] = [
  {
    id: "welcome-e1",
    source: "welcome-1",
    target: "welcome-2",
    type: "mathEdge",
    data: { label: "導出", type: "none", color: "#666666", directed: true, animated: true }
  }
]

// ------------------------------------------------------------------
// 2. 数式レンダリング用コンポーネント (プレーンテキストとして安全に表示)
// ------------------------------------------------------------------
const MathText: React.FC<{ text: string }> = ({ text }) => {
  return <span>{text}</span>
}

// ------------------------------------------------------------------
// 3. カスタムノード (MathNode)
// ------------------------------------------------------------------
const MathNode: React.FC<{ data: NodeData; selected: boolean }> = ({ data, selected }) => {
  const colors = NODE_COLORS[data.type || "definition"]

  return (
    <div
      className="custom-math-node"
      style={{
        padding: "12px 16px",
        borderRadius: "8px",
        background: colors.bg,
        border: `2px solid ${selected ? "#ff9800" : colors.border}`,
        boxShadow: selected ? "0 0 12px #ff9800" : "0 4px 6px rgba(0,0,0,0.05)",
        color: colors.text,
        minWidth: "180px",
        maxWidth: "280px",
        fontSize: "14px",
        fontWeight: "bold",
        textAlign: "center",
        transition: "all 0.15s ease",
        position: "relative",
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: colors.border, width: "10px", height: "10px", borderRadius: "50%" }}
      />
      <div style={{ wordBreak: "break-word" }}>
        <MathText text={data.label} />
      </div>
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: colors.border, width: "10px", height: "10px", borderRadius: "50%" }}
      />
    </div>
  )
}

// ------------------------------------------------------------------
// 4. カスタムエッジ (MathEdge) - 重なり回避ロジック付き
// ------------------------------------------------------------------
const MathEdge: React.FC<EdgeProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  data,
}) => {
  const sameRouteIndex = data?.sameRouteIndex || 0
  const sameRouteCount = data?.sameRouteCount || 1

  let curvature = 0.25
  if (sameRouteCount > 1) {
    curvature = 0.25 + (sameRouteIndex - (sameRouteCount - 1) / 2) * 0.15
  }

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature,
  })

  return (
    <>
      <path id={id} style={style} className="react-flow__edge-path" d={edgePath} markerEnd={markerEnd} />
      {data?.label && (
        <g transform={`translate(${labelX}, ${labelY})`}>
          <rect
            x={-40}
            y={-10}
            width={80}
            height={20}
            fill="white"
            rx={4}
            opacity={0.9}
            style={{ stroke: style.stroke || "#666", strokeWidth: 1 }}
          />
          <text
            textAnchor="middle"
            y={4}
            style={{ fontSize: "10px", fill: "#333", fontWeight: "bold", pointerEvents: "none" }}
          >
            {data.label}
          </text>
        </g>
      )}
    </>
  )
}

const nodeTypes = { mathNode: MathNode }
const edgeTypes = { mathEdge: MathEdge }

// ------------------------------------------------------------------
// 5. メインアプリケーションコンポーネント
// ------------------------------------------------------------------
export function App() {
  const { fitView } = useReactFlow()

  const [nodes, setNodes, onNodesChange] = useNodesState<NodeData>(welcomeNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<EdgeData>(welcomeEdges)

  const [treeName, setTreeName] = useState<string>("新しい単元名")
  const [savedTrees, setSavedTrees] = useState<string[]>([])
  const [isDirty, setIsDirty] = useState<boolean>(false)
  const [searchQuery, setSearchQuery] = useState<string>("")

  const [isModalOpen, setIsModalOpen] = useState<boolean>(false)
  const [newNodeLabel, setNewNodeLabel] = useState<string>("")
  const [newNodeDesc, setNewNodeDesc] = useState<string>("")
  const [newNodeType, setNewNodeType] = useState<NodeType>("definition")

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [connectSourceId, setConnectSourceId] = useState<string | null>(null)
  const [previewNode, setPreviewNode] = useState<Node<NodeData> | null>(null)

  useEffect(() => {
    const list = localStorage.getItem("math-tree-list")
    if (list) {
      const parsed = JSON.parse(list) as string[]
      setSavedTrees(parsed)
      if (parsed.length > 0) {
        loadTree(parsed[0])
      }
    }
  }, [])

  useEffect(() => {
    if (nodes !== welcomeNodes || edges !== welcomeEdges) {
      setIsDirty(true)
    }
  }, [nodes, edges])

  const selectedNodeData = useMemo(() => nodes.find((n) => n.id === selectedNodeId) || null, [nodes, selectedNodeId])
  const selectedEdgeData = useMemo(() => edges.find((e) => e.id === selectedEdgeId) || null, [edges, selectedEdgeId])

  useEffect(() => {
    if (selectedNodeId) {
      const node = nodes.find((n) => n.id === selectedNodeId)
      if (node) setPreviewNode(node)
    }
  }, [selectedNodeId, nodes])

  const saveCurrentTree = () => {
    if (!treeName.trim()) return alert("単元名を入力してください。")
    const data = { nodes, edges }
    localStorage.setItem(`math-tree-data-${treeName}`, JSON.stringify(data))

    if (!savedTrees.includes(treeName)) {
      const newList = [...savedTrees, treeName]
      setSavedTrees(newList)
      localStorage.setItem("math-tree-list", JSON.stringify(newList))
    }
    setIsDirty(false)
    alert(`「${treeName}」をローカルに保存しました！`)
  }

  const loadTree = (name: string) => {
    const raw = localStorage.getItem(`math-tree-data-${name}`)
    if (raw) {
      const parsed = JSON.parse(raw)
      setNodes(parsed.nodes || [])
      setEdges(parsed.edges || [])
      setTreeName(name)
      setIsDirty(false)
      setSelectedNodeId(null)
      setSelectedEdgeId(null)
      setPreviewNode(null)
    }
  }

  const exportJSON = () => {
    const dataStr = JSON.stringify({ nodes, edges, treeName }, null, 2)
    const blob = new Blob([dataStr], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `${treeName || "math-tree"}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const parsed = JSON.parse(evt.target?.result as string)
        if (parsed.nodes && parsed.edges) {
          setNodes(parsed.nodes)
          setEdges(parsed.edges)
          if (parsed.treeName) setTreeName(parsed.treeName)
          alert("JSONデータを正常に読み込みました。")
        }
      } catch (err) {
        alert("JSONファイルの解析に失敗しました。")
      }
    }
    reader.readAsText(file)
  }

const exportHTML = () => {
  // 1. データをオブジェクトにまとめ、JSON文字列化する
  const dataObj = { nodes, edges, treeName };
  const jsonData = JSON.stringify(dataObj);

  // 2. HTMLコンテンツを生成
 const htmlContent = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>【閲覧専用】${treeName || "数式マップ"}</title>
  <style>
    body { margin: 0; font-family: sans-serif; background: #fafafa; color: #333; }
    #canvas-container { position: relative; width: 100vw; height: calc(100vh - 50px); overflow: auto; }
    #mock-canvas { position: absolute; top: 0; left: 0; width: 3000px; height: 3000px; background: radial-gradient(#e0e0e0 1px, transparent 1px); background-size: 20px 20px; }
    .html-node { position: absolute; padding: 12px 16px; border-radius: 8px; font-size: 14px; font-weight: bold; background: white; border: 2px solid #ccc; cursor: pointer; min-width: 180px; box-shadow: 0 4px 6px rgba(0,0,0,0.06); }
    .definition { border-color: #2e7d32; color: #1b5e20; background: #e8f5e9; }
    .theorem { border-color: #0288d1; color: #0d47a1; background: #e3f2fd; }
    #info-panel { position: fixed; bottom: 20px; left: 20px; background: white; padding: 18px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); display: none; z-index: 1000; border-left: 6px solid #ccc; }
    svg { position: absolute; top: 0; left: 0; width: 3000px; height: 3000px; pointer-events: none; }
  </style>
</head>
<body>
  <div id="canvas-container">
    <div id="mock-canvas"><svg id="svg-edges"></svg></div>
  </div>
  <div id="info-panel">
    <div id="info-type"></div>
    <h4 id="info-title"></h4>
    <p id="info-desc" style="white-space: pre-wrap;"></p>
  </div>

  <script>
    const payload = ${jsonData};
    const { nodes, edges } = payload;
    const canvas = document.getElementById("mock-canvas");
    const svg = document.getElementById("svg-edges");
    const panel = document.getElementById("info-panel");
    const nodeMap = {};

    nodes.forEach(n => {
      const div = document.createElement("div");
      div.className = "html-node " + (n.data?.type || "definition");
      div.style.left = n.position.x + "px";
      div.style.top = n.position.y + "px";
      div.innerText = n.data?.label || "No Label";
      div.onclick = (e) => {
        e.stopPropagation();
        panel.style.display = "block";
        document.getElementById("info-type").innerText = n.data?.type === "theorem" ? "【定理】" : "【定義】";
        document.getElementById("info-title").innerText = n.data?.label || "";
        document.getElementById("info-desc").innerText = n.data?.description || "";
      };
      canvas.appendChild(div);
      nodeMap[n.id] = { ...n, el: div };
    });

    document.body.onclick = () => { panel.style.display = "none"; };

    edges.forEach((e, index) => {
      const src = nodeMap[e.source];
      const tgt = nodeMap[e.target];
      if (!src || !tgt) return;

      const pathId = "path_" + (e.id || index);
      const x1 = src.position.x + 200, y1 = src.position.y + 25;
      const x2 = tgt.position.x, y2 = tgt.position.y + 25;

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("id", pathId);
      path.setAttribute("d", \`M \${x1} \${y1} C \${x1 + 60} \${y1}, \${x2 - 60} \${y2}, \${x2} \${y2}\`);
      path.setAttribute("stroke", "#666");
      path.setAttribute("stroke-width", "2");
      path.setAttribute("fill", "none");
      svg.appendChild(path);

      if (e.data?.label) {
        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        const textPath = document.createElementNS("http://www.w3.org/2000/svg", "textPath");
        textPath.setAttributeNS(null, "href", "#" + pathId);
        textPath.setAttributeNS(null, "startOffset", "50%");
        textPath.setAttributeNS(null, "text-anchor", "middle");
        textPath.textContent = e.data.label;
        text.appendChild(textPath);
        text.style.fontSize = "12px";
        text.style.fill = "#555";
        svg.appendChild(text);
      }
    });
  </script>
</body>
</html>`;

  // ダウンロード実行
  const blob = new Blob([htmlContent], { type: "text/html" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "math_map.html";
  a.click();
};
  const addNode = useCallback(() => {
    if (!newNodeLabel.trim()) return
    const id = `node_${Date.now()}`
    const newNode: Node<NodeData> = {
      id,
      type: "mathNode",
      position: { x: Math.random() * 100 + 250, y: Math.random() * 100 + 200 },
      data: { label: newNodeLabel, type: newNodeType, description: newNodeDesc },
      style: { overflow: "visible" },
    }
    setNodes((nds) => nds.concat(newNode))
    setNewNodeLabel("")
    setNewNodeDesc("") // ★ここを修正しました (タイポ解消)
    setIsModalOpen(false)
  }, [newNodeLabel, newNodeDesc, newNodeType, setNodes])

  const onConnect = useCallback(
    (params: Connection) => {
      if (!params.source || !params.target) return
      const newEdge: Edge<EdgeData> = {
        id: `e-${params.source}-${params.target}-${Date.now()}`,
        source: params.source,
        target: params.target,
        type: "mathEdge",
        data: { label: "", type: "none", color: "#666666", directed: true, animated: false },
      }
      setEdges((eds) => addEdge(newEdge, eds))
    },
    [setEdges]
  )

  const onNodeClick = useCallback(
    (event: React.MouseEvent, node: Node<NodeData>) => {
      if (event.shiftKey) {
        setNodes((nds) => nds.filter((n) => n.id !== node.id))
        setEdges((eds) => eds.filter((e) => e.source !== node.id && e.target !== node.id))
        if (selectedNodeId === node.id) setSelectedNodeId(null)
        if (previewNode?.id === node.id) setPreviewNode(null)
        setConnectSourceId(null)
        return
      }

      setSelectedNodeId(node.id)
      setSelectedEdgeId(null)

      if (!connectSourceId) {
        setConnectSourceId(node.id)
      } else if (connectSourceId === node.id) {
        setConnectSourceId(null)
      } else {
        const existingEdge = edges.find(
          (e) =>
            (e.source === connectSourceId && e.target === node.id) ||
            (e.source === node.id && e.target === connectSourceId)
        )

        if (existingEdge) {
          setEdges((eds) => eds.filter((e) => e.id !== existingEdge.id))
        } else {
          const newEdge: Edge<EdgeData> = {
            id: `e-${connectSourceId}-${node.id}-${Date.now()}`,
            source: connectSourceId,
            target: node.id,
            type: "mathEdge",
            data: { label: "", type: "none", color: "#666666", directed: true, animated: false },
          }
          setEdges((eds) => addEdge(newEdge, eds))
        }
        setConnectSourceId(null)
      }
    },
    [connectSourceId, edges, selectedNodeId, previewNode, setNodes, setEdges]
  )

  const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    setSelectedEdgeId(edge.id)
    setSelectedNodeId(null)
    setConnectSourceId(null)
    setPreviewNode(null)
  }, [])

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null)
    setSelectedEdgeId(null)
    setConnectSourceId(null)
    setPreviewNode(null)
  }, [])

  const autoLayout = useCallback(() => {
    if (nodes.length === 0) return
    const dagreGraph = new dagre.graphlib.Graph()
    dagreGraph.setDefaultEdgeLabel(() => ({}))
    dagreGraph.setGraph({ rankdir: "LR", nodesep: 60, ranksep: 100 })

    nodes.forEach((node) => {
      const domNode = document.querySelector(`[data-node-id="${node.id}"]`) as HTMLElement
      const actualWidth = domNode ? domNode.offsetWidth : 250
      const actualHeight = domNode ? domNode.offsetHeight : 80
      dagreGraph.setNode(node.id, { width: actualWidth, height: actualHeight })
    })

    edges.forEach((edge) => {
      dagreGraph.setEdge(edge.source, edge.target)
    })

    dagre.layout(dagreGraph)

    setNodes((nds) =>
      nds.map((node) => {
        const nodeWithPosition = dagreGraph.node(node.id)
        const domNode = document.querySelector(`[data-node-id="${node.id}"]`) as HTMLElement
        const actualWidth = domNode ? domNode.offsetWidth : 250
        const actualHeight = domNode ? domNode.offsetHeight : 80

        return {
          ...node,
          position: {
            x: nodeWithPosition.x - actualWidth / 2,
            y: nodeWithPosition.y - actualHeight / 2,
          },
        }
      })
    )
  }, [nodes, edges, setNodes])

  const exportImage = useCallback(() => {
    const element = document.querySelector(".react-flow") as HTMLElement
    if (!element) return

    fitView({ padding: 0.1 })

    setTimeout(() => {
      toPng(element, {
        backgroundColor: "#fafafa",
        filter: (node: any) => {
          if (
            node.classList?.contains("react-flow__controls") ||
            node.classList?.contains("nodrag") ||
            node.tagName === "BUTTON" ||
            node.tagName === "INPUT" ||
            node.tagName === "SELECT"
          ) {
            return false
          }
          return true
        },
      })
        .then((dataUrl: any) => {
          const link = document.createElement("a")
          link.download = `${treeName || "math-tree"}.png`
          link.href = dataUrl
          link.click()
        })
        .catch((err: any) => {
          console.error("画像の生成に失敗しました:", err)
          alert("画像の出力中にエラーが発生しました。")
        })
    }, 150)
  }, [treeName, fitView])

  const routeCounts: Record<string, number> = {}
  const routeIndices = edges.map((e) => {
    const key = `${e.source}->${e.target}`
    const index = routeCounts[key] || 0
    routeCounts[key] = index + 1
    return index
  })

  const renderedEdges = edges.map((e, idx) => {
    const data = e.data || { label: "", type: "none", color: "#666666", directed: true, animated: false }
    const isSelected = selectedEdgeId === e.id
    const key = `${e.source}->${e.target}`

    return {
      ...e,
      type: "mathEdge",
      data: {
        ...data,
        sameRouteIndex: routeIndices[idx],
        sameRouteCount: routeCounts[key],
      },
      style: {
        stroke: isSelected ? "#ef5350" : data.color || "#666666",
        strokeWidth: isSelected ? 3 : 2,
        fill: "none",
      },
      markerEnd: data.directed
        ? {
            type: MarkerType.ArrowClosed,
            color: isSelected ? "#ef5350" : data.color || "#666666",
          }
        : undefined,
    }
  })

  return (
    <div style={{ width: "100vw", height: "100vh", background: "#fafafa", position: "relative" }}>
      {/* メインメニュー */}
      <div style={{ position: "absolute", top: 20, left: 20, zIndex: 10, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => setIsModalOpen(true)} style={{ padding: "10px 18px", cursor: "pointer", background: "#2e7d32", color: "white", border: "none", borderRadius: 4, fontWeight: "bold" }}>
            ＋ ノード追加
          </button>
          <button onClick={autoLayout} style={{ padding: "10px 18px", cursor: "pointer", background: "#0288d1", color: "white", border: "none", borderRadius: 4, fontWeight: "bold" }}>
            ✨ 自動で整地
          </button>
          <button onClick={exportImage} style={{ padding: "10px 18px", cursor: "pointer", background: "#6a1b9a", color: "white", border: "none", borderRadius: 4, fontWeight: "bold" }}>
            📸 画像で保存 (PNG)
          </button>
          <button onClick={exportHTML} style={{ padding: "10px 18px", background: "#455a64", color: "white", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: "bold" }}>
            🌐 HTMLとして保存
          </button>
          {isDirty && <span style={{ background: "#ef5350", width: 10, height: 10, borderRadius: "50%", display: "inline-block", alignSelf: "center" }} />}
        </div>

        <div style={{ display: "flex", gap: 8, background: "white", padding: "10px", borderRadius: 6, boxShadow: "0 2px 8px rgba(0,0,0,0.1)", alignItems: "center" }}>
          <select value={treeName} onChange={(e) => loadTree(e.target.value)} style={{ padding: "6px", borderRadius: 4, border: "1px solid #ccc" }}>
            {savedTrees.length === 0 && <option value="新しい単元名">保存データなし</option>}
            {savedTrees.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <input value={treeName} onChange={(e) => setTreeName(e.target.value)} placeholder="単元名" style={{ padding: "6px", width: "120px", borderRadius: 4, border: "1px solid #ccc" }} />
          <button onClick={saveCurrentTree} style={{ padding: "6px 12px", background: "#ef6c00", color: "white", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: "bold" }}>💾 保存</button>
          <button 
            onClick={() => {
              if (window.confirm(`本当に「${treeName}」を削除しますか？`)) {
                localStorage.removeItem(`math-tree-data-${treeName}`);
                const newList = savedTrees.filter(t => t !== treeName);
                setSavedTrees(newList);
                localStorage.setItem("math-tree-list", JSON.stringify(newList));
                setIsDirty(false)
                if (newList.length > 0) loadTree(newList[0]);
                else { setNodes(welcomeNodes); setEdges(welcomeEdges); setTreeName("新しい単元名"); }
              }
            }} 
            style={{ padding: "6px 12px", background: "#d32f2f", color: "white", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: "bold" }}
          >🗑️ 削除</button>
          <div style={{ width: "1px", height: "20px", background: "#ccc", margin: "0 4px" }} />
          
          <input 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="🔍 キーワード検索..."
            style={{ padding: "6px 10px", width: "160px", borderRadius: 4, border: "2px solid #ff9800", outline: "none", fontWeight: "bold" }} 
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} style={{ background: "none", border: "none", cursor: "pointer", color: "#888", marginLeft: -30, marginRight: 10, fontSize: 12 }}>✖</button>
          )}

          <div style={{ width: "1px", height: "20px", background: "#ccc", margin: "0 4px" }} />
          <button onClick={exportJSON} style={{ padding: "6px 12px", background: "#78909c", color: "white", border: "none", borderRadius: 4, cursor: "pointer", fontSize: "12px" }}>📤 出力</button>
          <label style={{ padding: "6px 12px", background: "#5c6bc0", color: "white", borderRadius: 4, cursor: "pointer", fontSize: "12px" }}>
            📥 読込<input type="file" accept=".json" onChange={handleImportJSON} style={{ display: "none" }} />
          </label>
        </div>
      </div>

      {/* プレビューパネル */}
      {previewNode && (
        <div style={{
          position: "absolute", bottom: 20, left: 20, zIndex: 100,
          background: "white", padding: "18px", borderRadius: "8px",
          boxShadow: "0 4px 20px rgba(0,0,0,0.18)", width: "auto", minWidth: "320px", maxWidth: "450px", height: "auto", maxHeight: "40vh", overflowY: "auto", 
          borderLeft: `5px solid ${NODE_COLORS[previewNode.data.type || "definition"].border}`, boxSizing: "border-box"
        }}>
          <div style={{ fontSize: "11px", fontWeight: "bold", color: "#888", marginBottom: "4px" }}>{previewNode.data.type === "definition" ? "【定義】" : "【定理】"}</div>
          <h4 style={{ margin: "0 0 8px 0", color: "#222", fontSize: "16px", wordBreak: "break-word" }}><MathText text={previewNode.data.label || ""} /></h4>
          <div style={{ margin: 0, fontSize: "13.5px", color: "#444", whiteSpace: "pre-wrap", lineHeight: "1.5", wordBreak: "break-word" }}><MathText text={previewNode.data.description || "※説明文はまだ登録されていません。"} /></div>
        </div>
      )}

      {/* モーダル */}
      {isModalOpen && (
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", background: "white", padding: 25, borderRadius: 8, boxShadow: "0 4px 20px rgba(0,0,0,0.15)", zIndex: 1000, display: "flex", flexDirection: "column", gap: 12, width: 320 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>新しい知識カード</h3>
          <input autoFocus placeholder="名前 (例: sin(α + β) )" value={newNodeLabel} onChange={(e) => setNewNodeLabel(e.target.value)} style={{ padding: 8, borderRadius: 4, border: "1px solid #ccc" }} />
          <textarea placeholder="説明文" value={newNodeDesc} onChange={(e) => setNewNodeDesc(e.target.value)} style={{ padding: 8, borderRadius: 4, border: "1px solid #ccc", height: 60, resize: "none" }} />
          <select value={newNodeType} onChange={(e) => setNewNodeType(e.target.value as any)} style={{ padding: 8, borderRadius: 4, border: "1px solid #ccc" }}>
            <option value="definition">定義 (緑)</option>
            <option value="theorem">定理 (青)</option>
          </select>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={addNode} style={{ flex: 1, padding: 8, background: "#2e7d32", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}>追加</button>
<button onClick={() => setIsModalOpen(false)} style={{ flex: 1, padding: 8, background: "#eee", border: "none", borderRadius: 4, cursor: "pointer" }}>キャンセル</button>
          </div>
        </div>
      )}

      {/* 右サイドパネル */}
      {(selectedNodeData || selectedEdgeData) && (
        <div style={{ position: "absolute", right: 0, top: 0, width: 260, height: "100%", background: "#263238", color: "white", padding: 20, zIndex: 5, boxSizing: "border-box" }}>
          {selectedNodeData && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <h3 style={{ borderBottom: "1px solid #4f5b62", paddingBottom: 8, margin: 0 }}>ノード編集</h3>
              <div style={{ background: "#37474f", padding: "8px", borderRadius: 4, minHeight: "35px", fontSize: "14px" }}>
                <span style={{ fontSize: "10px", color: "#b0bec5", display: "block" }}>表示</span>
                <MathText text={selectedNodeData.data.label || "未入力"} />
              </div>
              <label style={{ fontSize: 13, color: "#b0bec5" }}>名前</label>
              <input value={selectedNodeData.data.label} onChange={(e) => setNodes(nds => nds.map(n => n.id === selectedNodeId ? { ...n, data: { ...n.data, label: e.target.value } } : n))} style={{ color: "black", padding: 8, borderRadius: 4, border: "none" }} />
              <label style={{ fontSize: 13, color: "#b0bec5" }}>説明文</label>
              <textarea value={selectedNodeData.data.description || ""} onChange={(e) => setNodes(nds => nds.map(n => n.id === selectedNodeId ? { ...n, data: { ...n.data, description: e.target.value } } : n))} style={{ color: "black", padding: 8, borderRadius: 4, border: "none", height: 100, resize: "none" }} />
              <label style={{ fontSize: 13, color: "#b0bec5" }}>種類切替</label>
              <select value={selectedNodeData.data.type} onChange={(e) => setNodes(nds => nds.map(n => n.id === selectedNodeId ? { ...n, data: { ...n.data, type: e.target.value as any } } : n))} style={{ color: "black", padding: 8, borderRadius: 4, border: "none" }}>
                <option value="definition">定義 (緑)</option>
                <option value="theorem">定理 (青)</option>
              </select>
            </div>
          )}

          {selectedEdgeData && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <h3 style={{ borderBottom: "1px solid #4f5b62", paddingBottom: 8, margin: 0 }}>エッジ編集</h3>
              <label style={{ fontSize: 13, color: "#b0bec5" }}>関係ラベル名</label>
              <input value={selectedEdgeData.data?.label || ""} onChange={(e) => setEdges(eds => eds.map(ed => ed.id === selectedEdgeId ? { ...ed, data: { ...ed.data, label: e.target.value } as any } : ed))} style={{ color: "black", padding: 8, borderRadius: 4, border: "none" }} />
              <label style={{ fontSize: 13, color: "#b0bec5" }}>関係プリセット</label>
              <select value={selectedEdgeData.data?.type || "none"} onChange={(e) => {
                const val = e.target.value as any
                const labelText = val === "none" ? "" : val === "generalization" ? "一般化" : val === "extension" ? "拡張" : val === "example" ? "例" : "証明"
                setEdges(eds => eds.map(ed => ed.id === selectedEdgeId ? { ...ed, data: { ...ed.data, type: val, label: labelText } as any } : ed))
              }} style={{ color: "black", padding: 8, borderRadius: 4, border: "none" }}>
                <option value="none">指定なし</option>
                <option value="generalization">一般化</option>
                <option value="extension">拡張</option>
                <option value="example">例</option>
                <option value="proof">証明</option>
              </select>
              <label style={{ fontSize: 13, color: "#b0bec5" }}>線の色</label>
              <input type="color" value={selectedEdgeData.data?.color || "#666666"} onChange={(e) => setEdges(eds => eds.map(ed => ed.id === selectedEdgeId ? { ...ed, data: { ...ed.data, color: e.target.value } as any } : ed))} style={{ width: "100%", height: 35, padding: 0, border: "none", cursor: "pointer" }} />
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, marginTop: 10, cursor: "pointer" }}>
                <input type="checkbox" checked={selectedEdgeData.data?.animated ?? false} onChange={(e) => setEdges(eds => eds.map(ed => ed.id === selectedEdgeId ? { ...ed, data: { ...ed.data, animated: e.target.checked } as any } : ed))} />
                💡 アニメーションをON
              </label>
            </div>
          )}
          <button onClick={() => { setSelectedNodeId(null); setSelectedEdgeId(null); }} style={{ marginTop: 30, width: "100%", padding: 8, background: "#4f5b62", border: "none", color: "white", borderRadius: 4, cursor: "pointer" }}>閉じる</button>
        </div>
      )}

      {/* ReactFlow */}
      <ReactFlow 
        nodes={nodes} edges={renderedEdges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} onNodeClick={onNodeClick} onEdgeClick={onEdgeClick} onPaneClick={onPaneClick} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  )
}

export default function AppWrapper() {
  return (
    <ReactFlowProvider>
      <App />
    </ReactFlowProvider>
  )
}