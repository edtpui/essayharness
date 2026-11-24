"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import Link from "next/link";
import { api, messageOf } from "@/lib/api";
import { forceLayout, type Point } from "@/lib/force-layout";
import { CATEGORIES, CATEGORY_LABELS, GRAPH_NODE_KINDS, type Category, type GraphData, type GraphNode, type GraphNodeKind } from "@/lib/types";
import { normalizeForMatch } from "@/lib/text";
import { Badge, Button, EmptyState, Notice, PageHeader, TextInput, cx } from "../ui";

const CATEGORY_COLORS = Object.fromEntries(CATEGORIES.map((c) => [c, `var(--color-cat-${c})`])) as Record<Category, string>;

const KIND_LABEL: Record<GraphNodeKind, string> = {
	experience: "Experiences",
	skill: "Shared qualities",
	person: "Shared people",
	essay: "Essays",
	document: "Uploaded documents",
};

const RADIUS: Record<GraphNodeKind, number> = { experience: 9, skill: 5, person: 5, essay: 11, document: 7 };

interface View {
	x: number;
	y: number;
	w: number;
	h: number;
}

export function GraphPage() {
	const [graph, setGraph] = useState<GraphData | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [shown, setShown] = useState<Record<GraphNodeKind, boolean>>({ experience: true, skill: true, person: true, essay: true, document: true });
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState<string | null>(null);
	const [hovered, setHovered] = useState<string | null>(null);
	const [view, setView] = useState<View>({ x: -600, y: -450, w: 1200, h: 900 });
	const svgRef = useRef<SVGSVGElement>(null);
	const drag = useRef<{ startX: number; startY: number; view: View; moved: boolean } | null>(null);
	const [box, setBox] = useState({ width: 800, height: 600 });

	useEffect(() => {
		const el = svgRef.current;
		if (!el) return;
		const observer = new ResizeObserver(([entry]) => {
			if (entry) setBox({ width: Math.max(1, entry.contentRect.width), height: Math.max(1, entry.contentRect.height) });
		});
		observer.observe(el);
		return () => observer.disconnect();
	}, [graph]);

	useEffect(() => {
		api<{ graph: GraphData }>("/api/graph")
			.then((r) => setGraph(r.graph))
			.catch((err) => setError(messageOf(err)));
	}, []);

	const visible = useMemo(() => {
		if (!graph) return { nodes: [] as GraphNode[], edges: [] as GraphData["edges"] };
		const nodes = graph.nodes.filter((n) => shown[n.kind]);
		const ids = new Set(nodes.map((n) => n.id));
		return { nodes, edges: graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) };
	}, [graph, shown]);

	const positions = useMemo<Map<string, Point>>(
		() => forceLayout(visible.nodes.map((n) => n.id), visible.edges, Math.max(900, Math.sqrt(visible.nodes.length) * 160)),
		[visible],
	);

	// Fit the view to the laid-out graph.
	useEffect(() => {
		if (!positions.size) return;
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		for (const p of positions.values()) {
			minX = Math.min(minX, p.x);
			minY = Math.min(minY, p.y);
			maxX = Math.max(maxX, p.x);
			maxY = Math.max(maxY, p.y);
		}
		// Fit to the panel, leaving screen space for labels to the right of nodes.
		const left = 40, right = 230, top = 40, bottom = 40;
		const scale = Math.max((maxX - minX || 1) / Math.max(100, box.width - left - right), (maxY - minY || 1) / Math.max(100, box.height - top - bottom), 0.3);
		const w = box.width * scale;
		const h = box.height * scale;
		const usedH = (maxY - minY) / scale;
		setView({ x: minX - left * scale, y: minY - (top + (box.height - top - bottom - usedH) / 2) * scale, w, h });
	}, [positions, box.width, box.height]);

	const neighbors = useMemo(() => {
		const map = new Map<string, Set<string>>();
		for (const e of visible.edges) {
			if (!map.has(e.source)) map.set(e.source, new Set());
			if (!map.has(e.target)) map.set(e.target, new Set());
			map.get(e.source)!.add(e.target);
			map.get(e.target)!.add(e.source);
		}
		return map;
	}, [visible.edges]);

	const matches = useMemo(() => {
		const q = normalizeForMatch(query);
		if (!q) return null;
		return new Set(visible.nodes.filter((n) => normalizeForMatch(`${n.label} ${n.detail}`).includes(q)).map((n) => n.id));
	}, [query, visible.nodes]);

	const focus = hovered ?? selected;
	const focusSet = focus ? new Set([focus, ...(neighbors.get(focus) ?? [])]) : null;
	const byId = useMemo(() => new Map(visible.nodes.map((n) => [n.id, n])), [visible.nodes]);
	const selectedNode = selected ? byId.get(selected) ?? null : null;

	const toGraph = (clientX: number, clientY: number): Point => {
		const rect = svgRef.current!.getBoundingClientRect();
		const scale = Math.max(view.w / rect.width, view.h / rect.height);
		const offsetX = (rect.width * scale - view.w) / 2;
		const offsetY = (rect.height * scale - view.h) / 2;
		return { x: view.x - offsetX + (clientX - rect.left) * scale, y: view.y - offsetY + (clientY - rect.top) * scale };
	};

	const onWheel = (e: ReactWheelEvent<SVGSVGElement>) => {
		const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
		const at = toGraph(e.clientX, e.clientY);
		setView((v) => {
			const w = Math.min(20000, Math.max(150, v.w * factor));
			const h = (v.h / v.w) * w;
			return { x: at.x - ((at.x - v.x) * w) / v.w, y: at.y - ((at.y - v.y) * h) / v.h, w, h };
		});
	};

	const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
		drag.current = { startX: e.clientX, startY: e.clientY, view, moved: false };
		(e.target as Element).setPointerCapture?.(e.pointerId);
	};
	const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
		const d = drag.current;
		if (!d) return;
		const rect = svgRef.current!.getBoundingClientRect();
		const scale = Math.max(d.view.w / rect.width, d.view.h / rect.height);
		const mx = e.clientX - d.startX;
		const my = e.clientY - d.startY;
		if (Math.abs(mx) + Math.abs(my) > 3) d.moved = true;
		setView({ ...d.view, x: d.view.x - mx * scale, y: d.view.y - my * scale });
	};
	const onPointerUp = () => {
		drag.current = null;
	};

	const counts = useMemo(() => {
		const c: Partial<Record<GraphNodeKind, number>> = {};
		for (const n of graph?.nodes ?? []) c[n.kind] = (c[n.kind] ?? 0) + 1;
		return c;
	}, [graph]);

	// Graph units per screen pixel: sizes below are in pixels times this.
	const labelScale = Math.max(view.w / box.width, view.h / box.height);

	return (
		<>
			<PageHeader
				title="Graph"
				description="Your experiences, linked by the qualities and people they share, the essays that use them, and the documents they came from. Scroll to zoom, drag to pan, click a node for details."
			/>
			{error && <Notice className="mb-4">{error}</Notice>}
			{graph && graph.nodes.length === 0 ? (
				<EmptyState>
					Nothing to show yet. <Link href="/" className="underline">Capture</Link> or upload a few experiences first.
				</EmptyState>
			) : (
				<div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
					<div className="min-w-0">
						<div className="mb-2 flex flex-wrap items-center gap-2">
							{GRAPH_NODE_KINDS.map((kind) => (
								<label key={kind} className="flex items-center gap-1.5 panel px-2 py-1 text-xs">
									<input type="checkbox" checked={shown[kind]} onChange={(e) => setShown((s) => ({ ...s, [kind]: e.target.checked }))} />
									{KIND_LABEL[kind]} <span className="text-muted tabular-nums">{counts[kind] ?? 0}</span>
								</label>
							))}
							<TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find…" className="h-8 max-w-48" aria-label="Find in graph" />
						</div>
						<div className="relative h-[calc(100vh-15rem)] min-h-[420px] overflow-hidden panel">
							{!graph && <p className="p-4 text-sm text-muted">Loading…</p>}
							<svg
								ref={svgRef}
								className="h-full w-full touch-none select-none"
								viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
								onWheel={onWheel}
								onPointerDown={onPointerDown}
								onPointerMove={onPointerMove}
								onPointerUp={onPointerUp}
								onClick={(e) => {
									if (e.target === svgRef.current && !drag.current?.moved) setSelected(null);
								}}
								role="img"
								aria-label="Experience graph"
							>
								<g>
									{visible.edges.map((e, i) => {
										const a = positions.get(e.source);
										const b = positions.get(e.target);
										if (!a || !b) return null;
										const lit = focusSet ? focusSet.has(e.source) && focusSet.has(e.target) : false;
										return (
											<line
												key={i}
												x1={a.x}
												y1={a.y}
												x2={b.x}
												y2={b.y}
												stroke={lit ? "var(--accent)" : "var(--border-strong)"}
												strokeOpacity={focusSet && !lit ? 0.15 : lit ? 0.9 : 0.55}
												strokeWidth={(lit ? 1.6 : 1) * labelScale}
												strokeDasharray={e.kind === "from" ? `${4 * labelScale} ${3 * labelScale}` : undefined}
											/>
										);
									})}
								</g>
								<g>
									{visible.nodes.map((n) => {
										const p = positions.get(n.id);
										if (!p) return null;
										const dim = (focusSet && !focusSet.has(n.id)) || (matches && !matches.has(n.id));
										const r = RADIUS[n.kind] * labelScale;
										const fill = n.kind === "experience" ? CATEGORY_COLORS[n.category ?? "other"] : n.kind === "essay" ? "var(--accent)" : "var(--surface)";
										const showLabel = n.kind === "experience" || n.kind === "essay" || n.kind === "document" || focusSet?.has(n.id) || matches?.has(n.id);
										return (
											<g
												key={n.id}
												opacity={dim ? 0.2 : 1}
												className="cursor-pointer"
												onPointerEnter={() => setHovered(n.id)}
												onPointerLeave={() => setHovered(null)}
												onPointerDown={(e) => e.stopPropagation()}
												onClick={(e) => {
													e.stopPropagation();
													setSelected(n.id);
												}}
											>
												{n.kind === "document" ? (
													<rect x={p.x - r} y={p.y - r} width={r * 2} height={r * 2} rx={r * 0.25} fill={fill} stroke="var(--muted)" strokeWidth={1.2 * labelScale} />
												) : (
													<circle
														cx={p.x}
														cy={p.y}
														r={r}
														fill={fill}
														stroke={n.id === selected ? "var(--text)" : n.kind === "skill" ? "var(--accent)" : n.kind === "person" ? "var(--warn)" : "var(--bg)"}
														strokeWidth={(n.id === selected ? 2.5 : 1.2) * labelScale}
													/>
												)}
												{showLabel && (
													<text
														x={p.x + r + 3 * labelScale}
														y={p.y + 4 * labelScale}
														fontSize={(n.kind === "experience" || n.kind === "essay" ? 12 : 10.5) * labelScale}
														fill={n.kind === "skill" || n.kind === "person" ? "var(--muted)" : "var(--text)"}
														fontWeight={n.kind === "essay" ? 600 : 400}
													>
														{n.label.length > 34 ? `${n.label.slice(0, 33)}…` : n.label}
													</text>
												)}
											</g>
										);
									})}
								</g>
							</svg>
						</div>
					</div>

					<aside className="grid min-w-0 content-start gap-4 text-sm [&>*]:min-w-0">
						{selectedNode ? (
							<NodeDetails node={selectedNode} neighbors={[...(neighbors.get(selectedNode.id) ?? [])].map((id) => byId.get(id)).filter((n): n is GraphNode => Boolean(n))} onSelect={setSelected} />
						) : (
							<p className="text-muted">Click a node to see what it connects to.</p>
						)}
						<div>
							<p className="mb-1.5 text-xs font-medium text-muted">Experience categories</p>
							<ul className="grid gap-1">
								{CATEGORIES.map((c) => (
									<li key={c} className="flex items-center gap-2 text-xs">
										<span className="inline-block size-2.5 rounded-full" style={{ background: CATEGORY_COLORS[c] }} />
										{CATEGORY_LABELS[c]}
									</li>
								))}
							</ul>
							<p className="mt-3 text-xs text-muted">
								Filled accent circles are essays; small ringed circles are qualities (green ring) and people (amber ring) shared by two or more experiences;
								squares are uploaded documents, linked by dashed lines to what was taken from them.
							</p>
						</div>
					</aside>
				</div>
			)}
		</>
	);
}

function NodeDetails({ node, neighbors, onSelect }: { node: GraphNode; neighbors: GraphNode[]; onSelect: (id: string) => void }) {
	const kindLabel: Record<GraphNodeKind, string> = { experience: "Experience", skill: "Quality", person: "Person", essay: "Essay", document: "Document" };
	return (
		<div className="panel px-3 py-3">
			<div className="mb-1 flex items-center gap-2">
				<Badge tone={node.kind === "essay" ? "accent" : "neutral"}>{kindLabel[node.kind]}</Badge>
				{node.category && <span className="inline-block size-2.5 rounded-full" style={{ background: CATEGORY_COLORS[node.category] }} />}
			</div>
			<p className="font-medium">{node.label}</p>
			{node.detail && <p className="mt-1 text-muted">{node.detail}</p>}
			{node.href && (
				<Link href={node.href} className="mt-2 inline-block">
					<Button size="sm">{node.kind === "essay" ? "Open essay" : node.kind === "document" ? "Open in Capture" : "Open in bank"}</Button>
				</Link>
			)}
			{neighbors.length > 0 && (
				<div className="mt-3">
					<p className="mb-1 text-xs font-medium text-muted">Connected to {neighbors.length}</p>
					<ul className="grid max-h-64 min-w-0 grid-cols-1 gap-0.5 overflow-y-auto">
						{neighbors.map((n) => (
							<li key={n.id}>
								<button type="button" className={cx("block w-full min-w-0 truncate rounded px-1.5 py-0.5 text-left text-xs hover:bg-paper-2")} onClick={() => onSelect(n.id)} title={n.label}>
									{n.label}
								</button>
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}
