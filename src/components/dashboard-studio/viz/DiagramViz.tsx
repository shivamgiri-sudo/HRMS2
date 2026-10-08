import { Background, Position, ReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { GitFork, Radar as RadarIcon, Workflow } from "lucide-react";
import { Legend, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Sankey, Tooltip } from "recharts";
import { axisTick, formatValue } from "../format";
import { frameRows, measures, toFlow, toFrame, topN } from "../shape";
import type { QueryResult, Theme, VizProps, VizStyle } from "../types";
import type { VizDef } from "./def";

const NEEDS_FLOW = "Needs two dimensions and a positive measure.";

function Message({ theme, text = "No data" }: { theme: Theme; text?: string }) {
  return <div className="flex h-full w-full items-center justify-center p-3 text-center text-sm" style={{ color: theme.muted }}>{text}</div>;
}
const tooltipStyle = (theme: Theme) => ({ background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 6, color: theme.text, fontSize: 12 });

function RadarViz({ result, style, theme, colors }: VizProps) {
  const ms = measures(result);
  if (!ms.length || !result.rows.length) return <Message theme={theme} />;
  // At most 10 spokes: up to 9 categories plus "Other".
  const frame = topN(toFrame(result), Math.min(style.topN && style.topN > 0 ? style.topN : 9, 9));
  const format = frame.series[0]?.format ?? "number";
  const legend = style.legend ?? (frame.series.length > 1 ? "bottom" : "none");
  return (
    <div className="h-full w-full" role="img" aria-label={`Radar chart of ${frame.series.map((s) => s.label).join(", ")}`}>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={frameRows(frame)} outerRadius="70%">
          <PolarGrid stroke={theme.grid} />
          <PolarAngleAxis dataKey="name" tick={{ fill: theme.muted, fontSize: 11 }} />
          <PolarRadiusAxis tick={{ fill: theme.muted, fontSize: 10 }} stroke={theme.grid} tickFormatter={(v: number) => axisTick(v, format)} />
          {frame.series.map((s, i) => (
            <Radar key={s.key} name={s.label} dataKey={s.key} stroke={colors[i % colors.length]} fill={colors[i % colors.length]} fillOpacity={0.2} isAnimationActive={false} />
          ))}
          <Tooltip contentStyle={tooltipStyle(theme)} formatter={(v, name, item) => [formatValue(typeof v === "number" ? v : null, frame.series.find((s) => s.key === item?.dataKey)?.format ?? format, style), name]} />
          {legend !== "none" && (
            <Legend verticalAlign={legend === "top" ? "top" : legend === "right" ? "middle" : "bottom"} align={legend === "right" ? "right" : "center"} layout={legend === "right" ? "vertical" : "horizontal"} wrapperStyle={{ color: theme.muted, fontSize: 12 }} />
          )}
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

interface SankeyNodeProps { x?: number; y?: number; width?: number; height?: number; index?: number; payload?: { name?: string; value?: number }; theme: Theme; colors: string[]; chartWidth?: number }
function SankeyNode({ x = 0, y = 0, width = 0, height = 0, index = 0, payload, theme, colors }: SankeyNodeProps) {
  // Left-hand nodes (sources) are labelled to their right; right-hand nodes to their left.
  const left = x < 120;
  return (
    <g>
      <rect x={x} y={y} width={width} height={Math.max(height, 1)} fill={colors[index % colors.length]} rx={2} />
      <text x={left ? x + width + 6 : x - 6} y={y + height / 2} textAnchor={left ? "start" : "end"} dominantBaseline="middle" fontSize={11} fill={theme.text}>{payload?.name ?? ""}</text>
    </g>
  );
}
interface SankeyLinkProps { sourceX?: number; targetX?: number; sourceY?: number; targetY?: number; sourceControlX?: number; targetControlX?: number; linkWidth?: number; color: string }
function SankeyLink({ sourceX = 0, targetX = 0, sourceY = 0, targetY = 0, sourceControlX = 0, targetControlX = 0, linkWidth = 0, color }: SankeyLinkProps) {
  const h = Math.max(linkWidth, 1) / 2;
  const d = `M${sourceX},${sourceY - h} C${sourceControlX},${sourceY - h} ${targetControlX},${targetY - h} ${targetX},${targetY - h} L${targetX},${targetY + h} C${targetControlX},${targetY + h} ${sourceControlX},${sourceY + h} ${sourceX},${sourceY + h} Z`;
  return <path d={d} fill={color} fillOpacity={0.35} stroke="none" />;
}

function SankeyViz({ result, style, theme, colors }: VizProps) {
  const flow = toFlow(result), m = measures(result)[0];
  if (!m || !flow.links.length) return <Message theme={theme} text={NEEDS_FLOW} />;
  return (
    <div className="h-full w-full" role="img" aria-label={`Sankey diagram of ${m.label}, ${flow.links.length} flows`}>
      <ResponsiveContainer width="100%" height="100%">
        <Sankey data={flow} nodePadding={18} nodeWidth={12} iterations={32} margin={{ top: 10, right: 12, bottom: 10, left: 12 }}
          node={<SankeyNode theme={theme} colors={colors} />} link={<SankeyLink color={colors[0]} />}>
          <Tooltip contentStyle={tooltipStyle(theme)} formatter={(v) => formatValue(typeof v === "number" ? v : null, m.format, style)} />
        </Sankey>
      </ResponsiveContainer>
    </div>
  );
}

const COLUMN_GAP = 380, ROW_GAP = 72;
/**
 * Nodes and edges for the flow diagram: left-dimension values in a left column, right-dimension values in a right
 * column, one edge per link with its formatted value and a stroke width of 1..8 by value. Pure, so it is unit-tested.
 */
export function flowElements(result: QueryResult, style: VizStyle, colors: string[]): { nodes: Node[]; edges: Edge[] } {
  const flow = toFlow(result), m = measures(result)[0];
  if (!m || !flow.links.length) return { nodes: [], edges: [] };
  const isLeft = new Set(flow.links.map((l) => l.source));
  let li = 0, ri = 0;
  const nodes: Node[] = flow.nodes.map((n, i) => {
    const left = isLeft.has(i);
    return {
      id: `n${i}`, type: left ? "input" : "output", data: { label: n.name },
      position: { x: left ? 0 : COLUMN_GAP, y: (left ? li++ : ri++) * ROW_GAP },
      sourcePosition: Position.Right, targetPosition: Position.Left, draggable: false, connectable: false,
      style: { borderColor: colors[(left ? 0 : 1) % colors.length], borderWidth: 2, borderRadius: 6, fontSize: 12 },
    };
  });
  const values = flow.links.map((l) => l.value);
  const min = Math.min(...values), max = Math.max(...values);
  const edges: Edge[] = flow.links.map((l, i) => ({
    id: `e${i}`, source: `n${l.source}`, target: `n${l.target}`, label: flow.links.length <= 12 ? formatValue(l.value, m.format, style) : undefined,
    style: { stroke: colors[0], strokeWidth: max === min ? 3 : 1 + (7 * (l.value - min)) / (max - min), strokeOpacity: 0.7 },
  }));
  return { nodes, edges };
}

function FlowViz({ result, style, theme, colors }: VizProps) {
  const { nodes, edges } = flowElements(result, style, colors);
  if (!edges.length) return <Message theme={theme} text={NEEDS_FLOW} />;
  const themedNodes = nodes.map((n) => ({ ...n, style: { ...n.style, background: theme.card, color: theme.text } }));
  const themedEdges = edges.map((e) => ({ ...e, labelStyle: { fill: theme.text, fontSize: 11 }, labelBgStyle: { fill: theme.card }, labelBgPadding: [4, 2] as [number, number], labelBgBorderRadius: 3 }));
  return (
    <div className="h-full w-full" aria-label={`Flow diagram, ${nodes.length} nodes and ${edges.length} links`} role="group">
      <ReactFlow nodes={themedNodes} edges={themedEdges} fitView nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} panOnDrag zoomOnScroll
        colorMode={theme.dark ? "dark" : "light"} proOptions={{ hideAttribution: true }} style={{ background: "transparent" }}>
        <Background color={theme.grid} />
      </ReactFlow>
    </div>
  );
}

export const DIAGRAM_VIZ: VizDef[] = [
  {
    type: "radar", label: "Radar", category: "Diagrams", icon: RadarIcon, description: "Use to compare a few series across the same small set of categories.",
    needs: { dims: [1, 2], measures: [1, 4] }, defaultSize: { w: 5, h: 8 },
    styleOptions: ["palette", "legend", "numberFormat", "topN"], Component: RadarViz,
  },
  {
    type: "sankey", label: "Sankey", category: "Diagrams", icon: GitFork, description: "Use to show how volume flows from one set of categories to another.",
    needs: { dims: [2, 2], measures: [1, 1] }, defaultSize: { w: 8, h: 9 },
    styleOptions: ["palette", "numberFormat"], Component: SankeyViz,
  },
  {
    type: "flow", label: "Flow diagram", category: "Diagrams", icon: Workflow, description: "Use to map which categories connect to which, with the value on each connection.",
    needs: { dims: [2, 2], measures: [1, 1] }, defaultSize: { w: 8, h: 9 },
    styleOptions: ["palette", "numberFormat"], Component: FlowViz,
  },
];
