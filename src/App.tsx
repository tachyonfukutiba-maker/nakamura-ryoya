// @ts-ignore
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useCallback, useEffect } from "react"
import ReactFlow, {
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  addEdge,
  MarkerType,
  Handle,
  Position,
  getSmoothStepPath, // 🌟 かくかくエッジを採用
  EdgeLabelRenderer,
  ReactFlowProvider,
  useReactFlow,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
  type EdgeProps,
} from "reactflow"
import "reactflow/dist/style.css"
import "katex/dist/katex.min.css"
import { InlineMath } from "react-katex"
import { toPng } from "html-to-image"
import dagre from "dagre"

type NodeData = {
  label: string
  type: "definition" | "theorem"
  description?: string
}

type EdgeData = {
  label?: string
  type?: "none" | "generalization" | "extension" | "example" | "proof"
  color?: string
  directed?: boolean
  animated?: boolean
}

const NODE_COLORS = {
  definition: { background: "#e8f5e9", border: "#4caf50", text: "#1b5e20" },
  theorem: { background: "#e3f2fd", border: "#2196f3", text: "#0d47a1" }
}

// 🌐 【URL共有用】データを安全にBase64文字列に変換する関数
function encodeData(data: any): string {
  const jsonStr = JSON.stringify(data);
  // 日本語（UTF-8）を壊さないようにエンコードしてBase64化
  return btoa(encodeURIComponent(jsonStr).replace(/%([0-9A-F]{2})/g, (_, p1) => {
    return String.fromCharCode(parseInt(p1, 16));
  }));
}

// 🌐 【URL共有用】Base64文字列からデータを復元する関数
function decodeData(base64Str: string): any {
  try {
    const jsonStr = decodeURIComponent(Array.prototype.map.call(atob(base64Str), (c) => {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error("URLデータのデコードに失敗しました", e);
    return null;
  }
}

// 📐 日本語 ＋ 数式判別コンポーネント
function MathText({ text }: { text: string }) {
  if (!text) return <span></span>

  if (text.includes("```")) {
    const codeParts = text.split("```")
    return (
      <div style={{ textAlign: "left", width: "100%" }}>
        {codeParts.map((codePart, codeIndex) => {
          if (codeIndex % 2 === 1) {
            return (
              <pre key={codeIndex} style={{
                background: "#1e1e1e",
                color: "#d4d4d4",
                padding: "10px 14px",
                borderRadius: "4px",
                fontFamily: "Consolas, Monaco, 'Andale Mono', 'Ubuntu Mono', monospace",
                fontSize: "12.5px",
                overflowX: "auto",
                margin: "8px 0",
                lineHeight: "1.4",
                border: "1px solid #333",
                whiteSpace: "pre"
              }}>
                <code>{codePart.trim()}</code>
              </pre>
            )
          } else {
            return <MathText key={codeIndex} text={codePart} />
          }
        })}
      </div>
    )
  }

  const textStyle: React.CSSProperties = {
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    overflowWrap: "anywhere",
    textAlign: "left",
    display: "block",
    width: "100%"
  }

  if (!text.includes("$")) {
    return <div style={textStyle}>{text}</div>
  }

  const parts = text.split("$")
  return (
    <div style={textStyle}>
      {parts.map((part, index) => {
        if (index % 2 === 1) {
          return (
            <span key={index} style={{ display: "inline-block", verticalAlign: "middle", padding: "0 2px", whiteSpace: "normal" }}>
              <InlineMath math={part} />
            </span>
          )
        } else {
          return part
        }
      })}
    </div>
  )
}

// 🎯 カスタムノード
function MathNodeCustom({ data, selected, id }: NodeProps<NodeData>) {
  const type = data.type || "definition"
  const colorStyle = NODE_COLORS[type]

  return (
    <div 
      className="custom-math-node"
      data-node-id={id}
      style={{
        background: colorStyle.background,
        border: `2px solid ${selected ? "#ef5350" : colorStyle.border}`,
        borderRadius: "6px",
        color: colorStyle.text,
        fontWeight: "bold",
        padding: "12px 16px",
        minWidth: "160px",
        maxWidth: "600px",
        minHeight: "60px",
        width: "auto",
        height: "auto",
        resize: "both",
        overflow: "auto",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: selected ? "0 0 10px #ef5350" : "0 2px 4px rgba(0,0,0,0.05)",
        textAlign: "center",
        fontSize: "14px",
        wordBreak: "break-word",
        whiteSpace: "normal",
        transition: "border-color 0.2s, box-shadow 0.2s, opacity 0.2s"
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: colorStyle.border, width: 8, height: 8 }} />
      <div style={{ width: "100%", padding: "0 4px", wordWrap: "break-word", whiteSpace: "normal" }}>
        <MathText text={data.label || ""} />
      </div>
      <Handle type="source" position={Position.Right} style={{ background: colorStyle.border, width: 8, height: 8 }} />
    </div>
  )
}

// ⭕ カスタムエッジ（重複回避版）
function MathEdgeCustom({ id, sourceX, sourceY, targetX, targetY, sourcePosition = Position.Right, targetPosition = Position.Left, style = {}, markerEnd, data, selected }: EdgeProps<EdgeData>) {
  const isSelected = selected

  // 🎯【重なり防止機能】同じノード間を結ぶエッジがある場合、インデックスに応じて高さをわずかにずらす
  const edgeIndex = (data as any)?.sameRouteIndex || 0
  const totalEdges = (data as any)?.sameRouteCount || 1
  
  // 複数ある場合は、20pxずつ上下にずらして直角の通り道（中心点）を分ける
  const offset = totalEdges > 1 ? (edgeIndex - (totalEdges - 1) / 2) * 24 : 0

  const [edgePath, labelX, labelY] = getSmoothStepPath({ 
    sourceX, 
    sourceY: sourceY + (totalEdges > 1 ? (edgeIndex - (totalEdges - 1) / 2) * 4 : 0), // 接続点もわずかにずらす 
    sourcePosition, 
    targetX, 
    targetY: targetY + (totalEdges > 1 ? (edgeIndex - (totalEdges - 1) / 2) * 4 : 0), 
    targetPosition,
    borderRadius: 4,
    offset: 30 + offset // 🌟 ここで直角に曲がる位置をずらして線の重複を防ぐ！
  })

  const labelText = data?.label || ""

  const edgeStyle: React.CSSProperties = {
    ...style,
    stroke: isSelected ? "#ef5350" : (data?.color || "#666666"), 
    strokeWidth: isSelected ? 3 : 2,
    fill: "none", 
    transition: "stroke 0.2s, stroke-width 0.2s"
  }

  // 🌟 ラベルの位置も重ならないように、線のズレに合わせて上下に微調整
  const adjustedLabelY = labelY + (totalEdges > 1 ? (edgeIndex - (totalEdges - 1) / 2) * 12 : 0)

  return (
    <>
      <path 
        id={id} 
        style={edgeStyle} 
        className="react-flow__edge-path" 
        d={edgePath} 
        markerEnd={markerEnd} />
      {labelText && (
        <EdgeLabelRenderer>
          <div style={{ position: "absolute", transform: `translate(-50%, -50%) translate(${labelX}px,${adjustedLabelY}px)`, pointerEvents: "all", zIndex: 10 }} className="nodrag nopan">
            <div style={{ 
              background: "#ffffff", 
              padding: "4px 8px", 
              borderRadius: "4px", 
              boxShadow: "0 1px 4px rgba(0,0,0,0.1)", 
              border: `1px solid ${isSelected ? "#ef5350" : "#ccc"}`, 
              color: isSelected ? "#ef5350" : "#333", 
              fontSize: "11px",              
              fontWeight: "bold", 
              whiteSpace: "normal",          
              wordBreak: "break-word",      
              display: "block", 
              maxWidth: "140px",            
              width: "max-content",
              textAlign: "center"           
            }}>
              <MathText text={labelText} />
            </div>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

const nodeTypes = { mathNode: MathNodeCustom }
const edgeTypes = { mathEdge: MathEdgeCustom }

const welcomeNodes: Node<NodeData>[] = [
  { id: "welcome_1", type: "mathNode", position: { x: 100, y: 250 }, data: { label: "ようこそ！ $f(x) = x^n + 3x^2$", type: "definition", description: "数式ライブラリが有効化されています。$マークで囲むと自動で綺麗な数式になります。" } },
  { id: "welcome_2", type: "mathNode", position: { x: 600, y: 250 }, data: { label: "sin(α + β)", type: "theorem", description: "ギリシャ文字などもそのまま美しく描画されます。" } }
]

const welcomeEdges: Edge<EdgeData>[] = [
  { id: "welcome-edge", source: "welcome_1", target: "welcome_2", type: "mathEdge", data: { label: "つなぎ目", type: "none", color: "#0288d1", directed: true, animated: true } }
]

function App() {
  const { fitView } = useReactFlow()
  const [nodes, setNodes, onNodesChange] = useNodesState<NodeData>(welcomeNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<EdgeData>(welcomeEdges)

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [newNodeLabel, setNewNodeLabel] = useState("")
  const [newNodeDesc, setNewNodeDesc] = useState("")
  const [newNodeType, setNewNodeType] = useState<"definition" | "theorem">("definition")

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [connectSourceId, setConnectSourceId] = useState<string | null>(null)
  const [previewNode, setPreviewNode] = useState<Node<NodeData> | null>(null)

  const [treeName, setTreeName] = useState<string>("新しい単元名")
  const [savedTrees, setSavedTrees] = useState<string[]>([])
  const [isDirty, setIsDirty] = useState(false)
  const [searchQuery, setSearchQuery] = useState<string>("")

  const selectedNodeData = nodes.find((n) => n.id === selectedNodeId)
  const selectedEdgeData = edges.find((e) => e.id === selectedEdgeId)

  useEffect(() => {
    if (selectedNodeId) {
      const current = nodes.find(n => n.id === selectedNodeId)
      if (current) setPreviewNode(current)
    }
  }, [nodes, selectedNodeId])

  useEffect(() => {
    const hasNewContent = nodes.some(n => !n.id.startsWith("welcome_")) || edges.some(e => !e.id.startsWith("welcome"))
    if (hasNewContent) setIsDirty(true)
  }, [nodes, edges])

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault()
        e.returnValue = "変更が保存されていません。移動しますか？"
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => window.removeEventListener("beforeunload", handleBeforeUnload)
  }, [isDirty])

  useEffect(() => {
    const list = localStorage.getItem("math-tree-list")
    if (list) setSavedTrees(JSON.parse(list))
  }, [])

  // 🌐 【追加】起動時にURLの「?data=xxx」パラメータをチェックしてデータを復元
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sharedDataParam = params.get("data");
    
    if (sharedDataParam) {
      const decoded = decodeData(sharedDataParam);
      if (decoded && decoded.nodes && decoded.edges) {
        setNodes(decoded.nodes);
        setEdges(decoded.edges);
        setTreeName(decoded.treeName || "共有されたツリー");
        // 描画が安定するまで少し待ってから全体をフィットさせる
        setTimeout(() => fitView({ padding: 0.1 }), 200);
      }
    }
  }, []);

  // 🔍 検索窓連携
  useEffect(() => {
    nodes.forEach((node) => {
      const domNode = document.querySelector(`[data-node-id="${node.id}"]`) as HTMLElement
      if (!domNode) return

      if (!searchQuery.trim()) {
        domNode.style.opacity = "1"
        domNode.style.borderColor = node.id === selectedNodeId ? "#ef5350" : (NODE_COLORS[node.data.type || "definition"].border)
        domNode.style.boxShadow = node.id === selectedNodeId ? "0 0 10px #ef5350" : "0 2px 4px rgba(0,0,0,0.05)"
        return
      }

      const label = (node.data.label || "").toLowerCase()
      const desc = (node.data.description || "").toLowerCase()
      const q = searchQuery.toLowerCase()

      if (label.includes(q) || desc.includes(q)) {
        domNode.style.opacity = "1"
        domNode.style.borderColor = "#ff9800"
        domNode.style.boxShadow = "0 0 15px #ff9800"
      } else {
        domNode.style.opacity = "0.25"
        domNode.style.boxShadow = "none"
        domNode.style.borderColor = NODE_COLORS[node.data.type || "definition"].border
      }
    })
  }, [searchQuery, nodes, selectedNodeId])

  const loadTree = (name: string) => {
    if (isDirty && !window.confirm("現在の変更が保存されていません。切り替えますか？")) return
    const data = localStorage.getItem(`math-tree-data-${name}`)
    if (data) {
      const { nodes: sn, edges: se } = JSON.parse(data)
      setNodes(sn)
      setEdges(se)
      setTreeName(name)
      setSelectedNodeId(null)
      setSelectedEdgeId(null)
      setPreviewNode(null)
      setSearchQuery("")
      setTimeout(() => setIsDirty(false), 100)
    }
  }

  const saveCurrentTree = () => {
    if (!treeName.trim() || treeName === "新しい単元名") return alert("有効な単元名を入力してください")
    localStorage.setItem(`math-tree-data-${treeName}`, JSON.stringify({ nodes, edges }))
    if (!savedTrees.includes(treeName)) {
      const newList = [...savedTrees, treeName]
      setSavedTrees(newList)
      localStorage.setItem("math-tree-list", JSON.stringify(newList))
    }
    setIsDirty(false)
    alert(`「${treeName}」を保存しました！`)
  }

  // 🌐 【追加】現在の状態をエンコードして共有URLをクリップボードにコピーする関数
  const copyShareLink = () => {
    const payload = {
      treeName,
      nodes,
      edges
    };
    const encoded = encodeData(payload);
    // パラメータを付けたURLを生成 (現在のアドレスのベースを使用)
    const shareUrl = `${window.location.origin}${window.location.pathname}?data=${encoded}`;
    
    navigator.clipboard.writeText(shareUrl)
      .then(() => {
        alert("共有用URLをクリップボードにコピーしました！SNSやメールで共有できます。");
      })
      .catch((err) => {
        console.error("URLのコピーに失敗しました", err);
        alert("URLのコピーに失敗しました。お手数ですが、コンソール等をご確認ください。");
      });
  };

  const exportJSON = () => {
    const dataStr = JSON.stringify({ treeName, nodes, edges }, null, 2)
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr)
    const linkElement = document.createElement('a')
    linkElement.setAttribute('href', dataUri)
    linkElement.setAttribute('download', `${treeName || 'math-tree'}.json`)
    linkElement.click()
  }

  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileReader = new FileReader()
    if (e.target.files && e.target.files[0]) {
      fileReader.readAsText(e.target.files[0], "UTF-8")
      fileReader.onload = (event) => {
        try {
          const target = event.target?.result
          if (typeof target === "string") {
            const parsed = JSON.parse(target)
            if (parsed.nodes && parsed.edges) {
              setNodes(parsed.nodes)
              setEdges(parsed.edges)
              setTreeName(parsed.treeName || "インポートしたツリー")
              setIsDirty(true)
              setSearchQuery("")
              alert("ツリーを読み込みました！")
            }
          }
        } catch {
          alert("ファイルの読み込みに失敗しました。")
        }
      }
    }
  }

  const addNode = useCallback(() => {
    if (!newNodeLabel.trim()) return
    const id = `node_${Date.now()}`
    const newNode: Node<NodeData> = {
      id,
      type: "mathNode",
      position: { x: Math.random() * 100 + 250, y: Math.random() * 100 + 200 },
      data: { label: newNodeLabel, type: newNodeType, description: newNodeDesc },
      style: { overflow: "visible" }
    }
    setNodes((nds) => nds.concat(newNode))
    newNodeLabel && setNewNodeLabel("")
    newNodeDesc && setNewNodeDesc("")
    setIsModalOpen(false)
  }, [newNodeLabel, newNodeDesc, newNodeType, setNodes])

  const onConnect = useCallback((params: Connection) => {
    if (!params.source || !params.target) return
    const newEdge: Edge<EdgeData> = {
      id: `e-${params.source}-${params.target}-${Date.now()}`,
      source: params.source,
      target: params.target,
      type: "mathEdge",
      data: { label: "", type: "none", color: "#666666", directed: true, animated: false }
    }
    setEdges((eds) => addEdge(newEdge, eds) as any as Edge<EdgeData>[])
  }, [setEdges])

  const onNodeClick = useCallback((event: React.MouseEvent, node: Node<NodeData>) => {
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
        (e) => (e.source === connectSourceId && e.target === node.id) || (e.source === node.id && e.target === connectSourceId)
      )
      if (existingEdge) {
        setEdges((eds) => eds.filter((e) => e.id !== existingEdge.id))
      } else {
        const newEdge: Edge<EdgeData> = {
          id: `e-${connectSourceId}-${node.id}-${Date.now()}`,
          source: connectSourceId,
          target: node.id,
          type: "mathEdge",
          data: { label: "", type: "none", color: "#666666", directed: true, animated: false }
        }
        setEdges((eds) => addEdge(newEdge, eds) as any as Edge<EdgeData>[])
      }
      setConnectSourceId(null)
    }
  }, [connectSourceId, edges, selectedNodeId, previewNode, setNodes, setEdges])

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

  // 📐 簡潔さを維持する初期レイアウト
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

    fitView({ padding: 0.1 });

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
        }
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

  // 🎯【重なり自動検知インジェクション】
  // 同じ Source と Target を持つエッジの組み合わせを数え上げ、個々のエッジにインデックスを付与する
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
      // 🌟 ReactFlow標準のlabelプロパティにもテキストを明示的にセットする
      label: data.label || "", 
      animated: data.animated || false, 
      // カスタムエッジ内で重なりを回避するためのメタ情報を流し込む
      data: { 
        ...data,
        sameRouteIndex: routeIndices[idx],
        sameRouteCount: routeCounts[key]
      }, 
      style: {
        stroke: isSelected ? "#ef5350" : (data.color || "#666666"),
        strokeWidth: isSelected ? 3 : 2,
        fill: "none"
      },
      markerEnd: data.directed ? {
        type: MarkerType.ArrowClosed,
        color: isSelected ? "#ef5350" : (data.color || "#666666"),
      } : undefined,
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
          {/* 🌐 【追加】URL共有ボタン */}
          <button onClick={copyShareLink} style={{ padding: "10px 18px", cursor: "pointer", background: "#00b0ff", color: "white", border: "none", borderRadius: 4, fontWeight: "bold", display: "flex", alignItems: "center", gap: "6px" }}>
            🔗 共有URLをコピー
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
              <input value={selectedEdgeData.data?.label || ""} onChange={(e) => setEdges(eds => eds.map(ed => ed.id === selectedEdgeId ? { ...ed, data: { ...ed.data, label: e.target.value } } : ed))} style={{ color: "black", padding: 8, borderRadius: 4, border: "none" }} />
              <label style={{ fontSize: 13, color: "#b0bec5" }}>関係プリセット</label>
              <select value={selectedEdgeData.data?.type || "none"} onChange={(e) => {
                const val = e.target.value as any
                const labelText = val === "none" ? "" : val === "generalization" ? "一般化" : val === "extension" ? "拡張" : val === "example" ? "例" : "証明"
                setEdges(eds => eds.map(ed => ed.id === selectedEdgeId ? { ...ed, data: { ...ed.data, type: val, label: labelText } } : ed))
              }} style={{ color: "black", padding: 8, borderRadius: 4, border: "none" }}>
                <option value="none">指定なし</option>
                <option value="generalization">一般化</option>
                <option value="extension">拡張</option>
                <option value="example">例</option>
                <option value="proof">証明</option>
              </select>
              <label style={{ fontSize: 13, color: "#b0bec5" }}>線の色</label>
              <input type="color" value={selectedEdgeData.data?.color || "#666666"} onChange={(e) => setEdges(eds => eds.map(ed => ed.id === selectedEdgeId ? { ...ed, data: { ...ed.data, color: e.target.value } } : ed))} style={{ width: "100%", height: 35, padding: 0, border: "none", cursor: "pointer" }} />
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, marginTop: 10, cursor: "pointer" }}>
                <input type="checkbox" checked={selectedEdgeData.data?.animated ?? false} onChange={(e) => setEdges(eds => eds.map(ed => ed.id === selectedEdgeId ? { ...ed, data: { ...ed.data, animated: e.target.checked } } : ed))} />
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