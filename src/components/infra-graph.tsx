"use client";

import { useEffect, useRef } from "react";
import * as d3 from "d3";
import type { InfraGraph as InfraGraphData } from "@/lib/types";
import { typeColor } from "@/lib/component-types";

interface SimNode extends d3.SimulationNodeDatum {
  id: number;
  name: string;
  type: string;
  technology: string | null;
  criticality: string | null;
  status: string | null;
  degree: number;
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  id: number;
  source: SimNode;
  target: SimNode;
  kind: string;
  protocol: string | null;
  /** Index among links that share the same ordered (source, target) pair. */
  parallelIndex: number;
}

const BG = "#0f1117";
const NODE_FILL = "#1e293b";
const LINK_COLOR = "#64748b";
const DIM_OPACITY = 0.12;

function radius(d: SimNode): number {
  return 11 + Math.min(d.degree, 8) * 1.3;
}

/** Quadratic curve from source to target, trimmed to the node borders. */
function linkGeometry(d: SimLink) {
  const sx = d.source.x ?? 0;
  const sy = d.source.y ?? 0;
  const tx = d.target.x ?? 0;
  const ty = d.target.y ?? 0;
  const dx = tx - sx;
  const dy = ty - sy;
  const dist = Math.hypot(dx, dy) || 1;

  // Bend perpendicular to the line. Because the normal flips with direction,
  // A->B and B->A bow to opposite sides and never overlap.
  const bend = 14 + d.parallelIndex * 16;
  const cx = (sx + tx) / 2 + (-dy / dist) * bend;
  const cy = (sy + ty) / 2 + (dx / dist) * bend;

  const trim = (
    px: number,
    py: number,
    r: number
  ): [number, number] => {
    const vx = cx - px;
    const vy = cy - py;
    const len = Math.hypot(vx, vy) || 1;
    return [px + (vx / len) * r, py + (vy / len) * r];
  };
  const [x1, y1] = trim(sx, sy, radius(d.source) + 1);
  const [x2, y2] = trim(tx, ty, radius(d.target) + 5);

  return {
    path: `M${x1},${y1}Q${cx},${cy} ${x2},${y2}`,
    // Point on the curve at t = 0.5, used to anchor the label.
    labelX: 0.25 * x1 + 0.5 * cx + 0.25 * x2,
    labelY: 0.25 * y1 + 0.5 * cy + 0.25 * y2,
  };
}

interface InfraGraphProps {
  graph: InfraGraphData | null;
  selectedId: number | null;
  onSelect: (componentId: number | null) => void;
}

export function InfraGraph({ graph, selectedId, onSelect }: InfraGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  /** Last known positions, so refreshed data does not reshuffle the layout. */
  const positionsRef = useRef(new Map<number, { x: number; y: number }>());
  const transformRef = useRef<d3.ZoomTransform | null>(null);
  const highlightRef = useRef<(focusId: number | null) => void>(() => {});
  const selectedIdRef = useRef(selectedId);
  const onSelectRef = useRef(onSelect);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
    highlightRef.current(selectedId);
  }, [selectedId]);

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!graph || !svgEl) return;

    const width = svgEl.clientWidth;
    const height = svgEl.clientHeight;
    const positions = positionsRef.current;

    const degree = new Map<number, number>();
    for (const l of graph.links) {
      degree.set(l.source, (degree.get(l.source) ?? 0) + 1);
      degree.set(l.target, (degree.get(l.target) ?? 0) + 1);
    }

    // Each type gets an anchor on a ring; nodes are gently pulled to theirs.
    const types = Array.from(new Set(graph.nodes.map((n) => n.type)));
    const ring = Math.min(width, height) * 0.34;
    const anchors = new Map(
      types.map((type, i) => {
        const angle = (i / Math.max(types.length, 1)) * 2 * Math.PI - Math.PI / 2;
        return [
          type,
          {
            x: width / 2 + ring * Math.cos(angle),
            y: height / 2 + ring * Math.sin(angle),
          },
        ];
      })
    );

    const nodes: SimNode[] = graph.nodes.map((n) => {
      const known = positions.get(n.id);
      const anchor = anchors.get(n.type)!;
      return {
        ...n,
        degree: degree.get(n.id) ?? 0,
        x: known?.x ?? anchor.x + (Math.random() - 0.5) * 60,
        y: known?.y ?? anchor.y + (Math.random() - 0.5) * 60,
      };
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));

    const pairCount = new Map<string, number>();
    const links: SimLink[] = [];
    for (const l of graph.links) {
      const source = byId.get(l.source);
      const target = byId.get(l.target);
      if (!source || !target) continue;
      const key = `${l.source}>${l.target}`;
      const parallelIndex = pairCount.get(key) ?? 0;
      pairCount.set(key, parallelIndex + 1);
      links.push({ ...l, source, target, parallelIndex });
    }

    const neighbours = new Map<number, Set<number>>();
    for (const l of links) {
      if (!neighbours.has(l.source.id)) neighbours.set(l.source.id, new Set());
      if (!neighbours.has(l.target.id)) neighbours.set(l.target.id, new Set());
      neighbours.get(l.source.id)!.add(l.target.id);
      neighbours.get(l.target.id)!.add(l.source.id);
    }

    const svg = d3.select(svgEl);
    svg.selectAll("*").remove();

    const defs = svg.append("defs");
    for (const [id, color] of [
      ["arrow", LINK_COLOR],
      ["arrow-active", "#e2e8f0"],
    ]) {
      defs
        .append("marker")
        .attr("id", id)
        .attr("viewBox", "0 -5 10 10")
        .attr("refX", 8)
        .attr("refY", 0)
        .attr("markerWidth", 6)
        .attr("markerHeight", 6)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M0,-4L9,0L0,4Z")
        .attr("fill", color);
    }

    const g = svg.append("g");

    const linkSel = g
      .append("g")
      .attr("fill", "none")
      .selectAll<SVGPathElement, SimLink>("path")
      .data(links, (d) => d.id)
      .join("path")
      .attr("stroke", LINK_COLOR)
      .attr("stroke-width", 1.2)
      .attr("marker-end", "url(#arrow)");

    linkSel
      .append("title")
      .text(
        (d) =>
          `${d.source.name} ${d.kind} ${d.target.name}${d.protocol ? ` (${d.protocol})` : ""}`
      );

    const linkLabelSel = g
      .append("g")
      .attr("pointer-events", "none")
      .selectAll<SVGTextElement, SimLink>("text")
      .data(links, (d) => d.id)
      .join("text")
      .attr("text-anchor", "middle")
      .attr("font-size", "9px")
      .attr("fill", "#cbd5e1")
      .attr("paint-order", "stroke")
      .attr("stroke", BG)
      .attr("stroke-width", 3)
      .attr("opacity", 0)
      .text((d) => (d.protocol ? `${d.kind} · ${d.protocol}` : d.kind));

    const nodeSel = g
      .append("g")
      .selectAll<SVGGElement, SimNode>("g")
      .data(nodes, (d) => d.id)
      .join("g")
      .style("cursor", "pointer");

    nodeSel
      .append("circle")
      .attr("r", radius)
      .attr("fill", NODE_FILL)
      .attr("stroke", (d) => typeColor(d.type))
      .attr("stroke-width", (d) => (d.criticality === "High" ? 3 : 1.5))
      .attr("stroke-dasharray", (d) =>
        d.status === "Deprecated" ? "4,3" : d.status === "Planned" ? "1,3" : null
      );

    nodeSel
      .append("circle")
      .attr("r", 3.5)
      .attr("fill", (d) => typeColor(d.type))
      .attr("pointer-events", "none");

    nodeSel
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dy", (d) => radius(d) + 14)
      .attr("font-size", "11px")
      .attr("fill", "#e0e0e0")
      .attr("paint-order", "stroke")
      .attr("stroke", BG)
      .attr("stroke-width", 3)
      .attr("pointer-events", "none")
      .text((d) => d.name);

    nodeSel
      .append("title")
      .text(
        (d) =>
          `${d.name}\n${d.type}${d.technology ? ` · ${d.technology}` : ""}`
      );

    let hoveredId: number | null = null;

    const highlight = (selected: number | null) => {
      const focus = hoveredId ?? selected;
      const near = focus !== null ? neighbours.get(focus) : undefined;
      const nodeActive = (d: SimNode) =>
        focus === null || d.id === focus || (near?.has(d.id) ?? false);
      const linkActive = (d: SimLink) =>
        focus !== null && (d.source.id === focus || d.target.id === focus);

      nodeSel.attr("opacity", (d) => (nodeActive(d) ? 1 : DIM_OPACITY));
      nodeSel
        .select("circle")
        .attr("filter", (d) =>
          d.id === selected
            ? `drop-shadow(0 0 8px ${typeColor(d.type)})`
            : null
        );
      linkSel
        .attr("opacity", (d) =>
          focus === null ? 0.7 : linkActive(d) ? 1 : DIM_OPACITY
        )
        .attr("stroke", (d) => (linkActive(d) ? "#e2e8f0" : LINK_COLOR))
        .attr("stroke-width", (d) => (linkActive(d) ? 1.8 : 1.2))
        .attr("marker-end", (d) =>
          linkActive(d) ? "url(#arrow-active)" : "url(#arrow)"
        );
      linkLabelSel.attr("opacity", (d) => (linkActive(d) ? 1 : 0));
    };
    highlightRef.current = highlight;

    nodeSel
      .on("mouseenter", (_event, d) => {
        hoveredId = d.id;
        highlight(selectedIdRef.current);
      })
      .on("mouseleave", () => {
        hoveredId = null;
        highlight(selectedIdRef.current);
      })
      .on("click", (event, d) => {
        event.stopPropagation();
        onSelectRef.current(d.id);
      });

    svg.on("click", () => onSelectRef.current(null));

    const render = () => {
      linkSel.each(function (d) {
        d3.select(this).attr("d", linkGeometry(d).path);
      });
      linkLabelSel.each(function (d) {
        const { labelX, labelY } = linkGeometry(d);
        d3.select(this).attr("x", labelX).attr("y", labelY - 3);
      });
      nodeSel.attr("transform", (d) => `translate(${d.x},${d.y})`);
      for (const n of nodes) {
        positions.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
      }
    };

    const simulation = d3
      .forceSimulation(nodes)
      .force(
        "link",
        d3
          .forceLink<SimNode, SimLink>(links)
          .id((d) => d.id)
          .distance(170)
          .strength(0.18)
      )
      .force("charge", d3.forceManyBody().strength(-1100))
      .force(
        "collide",
        d3.forceCollide<SimNode>().radius((d) => radius(d) + 30)
      )
      .force(
        "x",
        d3.forceX<SimNode>((d) => anchors.get(d.type)!.x).strength(0.09)
      )
      .force(
        "y",
        d3.forceY<SimNode>((d) => anchors.get(d.type)!.y).strength(0.09)
      )
      .on("tick", render);

    // When every node already has a position, only settle gently. Otherwise
    // lay the graph out up front so it appears settled instead of exploding
    // into place.
    const allKnown = graph.nodes.every((n) => positions.has(n.id));
    if (allKnown) {
      simulation.alpha(0.15);
    } else {
      simulation.stop();
      simulation.tick(300);
      simulation.alpha(0.05).restart();
    }

    nodeSel.call(
      d3
        .drag<SVGGElement, SimNode>()
        .on("start", (event, d) => {
          if (!event.active) simulation.alphaTarget(0.25).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on("drag", (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on("end", (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        })
    );

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on("zoom", (event) => {
        transformRef.current = event.transform;
        g.attr("transform", event.transform.toString());
      });
    svg.call(zoom).on("dblclick.zoom", null);
    if (transformRef.current) {
      svg.call(zoom.transform, transformRef.current);
    } else if (nodes.length > 0) {
      // First render: fit the whole graph below the header.
      const pad = 70;
      const top = 90;
      const xs = nodes.map((n) => n.x ?? 0);
      const ys = nodes.map((n) => n.y ?? 0);
      const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
      const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
      const scale = Math.min(
        1.25,
        (width - 2 * pad) / Math.max(maxX - minX, 1),
        (height - top - pad) / Math.max(maxY - minY, 1)
      );
      svg.call(
        zoom.transform,
        d3.zoomIdentity
          .translate(width / 2, top + (height - top - pad) / 2)
          .scale(scale)
          .translate(-(minX + maxX) / 2, -(minY + maxY) / 2)
      );
    }

    // Forget positions of components that no longer exist.
    for (const id of Array.from(positions.keys())) {
      if (!byId.has(id)) positions.delete(id);
    }

    render();
    highlight(selectedIdRef.current);

    return () => {
      simulation.stop();
      highlightRef.current = () => {};
    };
  }, [graph]);

  return (
    <svg
      ref={svgRef}
      className="w-full h-full"
      style={{ background: BG }}
      role="img"
      aria-label="Infrastructure graph"
    />
  );
}
