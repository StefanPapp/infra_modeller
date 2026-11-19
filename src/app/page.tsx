"use client";

import { useState, useCallback, useEffect } from "react";
import { InfraGraph } from "@/components/infra-graph";
import { DetailPanel } from "@/components/detail-panel";
import { ChatPopover } from "@/components/chat-popover";
import { FaqModal } from "@/components/faq-modal";
import { ImportRepoDialog } from "@/components/import-repo-dialog";
import { typeColor } from "@/lib/component-types";
import type {
  ComponentDetail,
  InfraGraph as InfraGraphData,
} from "@/lib/types";

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

export default function Home() {
  const [graph, setGraph] = useState<InfraGraphData | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ComponentDetail | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    fetchJson<InfraGraphData>("/api/graph").then((data) => {
      if (cancelled) return;
      setLoadFailed(data === null);
      if (data) setGraph(data);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  useEffect(() => {
    if (selectedId === null) return;
    let cancelled = false;
    fetchJson<ComponentDetail>(`/api/components/${selectedId}`).then((data) => {
      if (cancelled) return;
      setDetail(data);
      // The component was deleted (e.g. via chat): drop the selection.
      if (!data) setSelectedId(null);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedId, refreshKey]);

  const handleClose = useCallback(() => setSelectedId(null), []);

  const visibleDetail =
    selectedId !== null && detail?.id === selectedId ? detail : null;
  const types = graph
    ? Array.from(new Set(graph.nodes.map((n) => n.type)))
    : [];

  return (
    <div className="flex h-screen">
      {/* Map area */}
      <div className="flex-1 relative min-w-0">
        {/* Header overlay */}
        <div
          className="absolute top-0 left-0 right-0 p-5 z-10 pointer-events-none"
          style={{
            background:
              "linear-gradient(180deg, rgba(15,17,23,0.95) 0%, transparent 100%)",
          }}
        >
          <h1 className="text-lg font-semibold text-white">Infra Modeller</h1>
          <p className="text-sm text-[#888] mt-1">
            {graph
              ? `${graph.nodes.length} components · ${graph.links.length} connections. `
              : ""}
            Click a node for details. Scroll to zoom. Drag to pan.
          </p>
        </div>

        <InfraGraph
          graph={graph}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />

        {graph && graph.nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-sm text-[#666] max-w-sm text-center">
              The map is empty. Import a repository or describe your first
              component in the chat.
            </p>
          </div>
        )}
        {loadFailed && !graph && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-sm text-[#ef4444] max-w-sm text-center">
              Could not load the model. Check DATABASE_URL and the server logs.
            </p>
          </div>
        )}

        <ImportRepoDialog onImported={refresh} />
        <FaqModal />

        {/* Legend */}
        {types.length > 0 && (
          <div className="absolute bottom-5 left-5 bg-[#161822]/90 border border-[#252838] rounded-lg p-3 z-10">
            <h4 className="text-[11px] uppercase tracking-wider text-[#666] mb-2">
              Component types
            </h4>
            <div className="space-y-1">
              {types.map((type) => (
                <div
                  key={type}
                  className="flex items-center gap-2 text-xs text-[#aaa]"
                >
                  <div
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: typeColor(type) }}
                  />
                  {type}
                </div>
              ))}
            </div>
            <p className="mt-2 pt-2 border-t border-[#252838] text-[10px] text-[#666]">
              A → B: A depends on B
            </p>
          </div>
        )}
      </div>

      {/* Detail panel */}
      <DetailPanel
        component={visibleDetail}
        components={graph?.nodes ?? []}
        onClose={handleClose}
        onSelectComponent={setSelectedId}
        onChanged={refresh}
      />

      {/* Chat */}
      <ChatPopover onModelChanged={refresh} />
    </div>
  );
}
