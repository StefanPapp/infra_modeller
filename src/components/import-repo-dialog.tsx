"use client";

import { useState } from "react";

interface ImportSummary {
  repo: string;
  ref: string;
  filesAnalysed: string[];
  createdComponents: string[];
  reusedComponents: string[];
  createdConnections: number;
  skippedConnections: { source: string; target: string; reason: string }[];
}

interface ImportRepoDialogProps {
  /** Called after a repository was imported successfully. */
  onImported: () => void;
}

export function ImportRepoDialog({ onImported }: ImportRepoDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  const close = () => {
    if (busy) return;
    setIsOpen(false);
    setError(null);
    setSummary(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setError(null);
    setSummary(null);
    try {
      const res = await fetch("/api/repos/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Import failed");
        return;
      }
      setSummary(body as ImportSummary);
      setUrl("");
      onImported();
    } catch {
      setError("Could not reach the server");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="absolute top-5 right-16 z-20 h-8 px-3 rounded-full bg-[#252838]/80 border border-[#252838] text-xs text-[#aaa] hover:text-white hover:border-[#3b82f6] flex items-center gap-1.5 transition-colors"
        title="Read a GitHub repository into the map"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        Import repository
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60"
          onClick={close}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Import repository"
            className="w-[520px] max-h-[80vh] bg-[#161822] border border-[#252838] rounded-xl shadow-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#252838] shrink-0">
              <h2 className="text-base font-semibold text-white">
                Import from a GitHub repository
              </h2>
              <button
                onClick={close}
                aria-label="Close"
                className="text-[#666] hover:text-white text-xl leading-none"
              >
                x
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <p className="text-sm text-[#888] leading-relaxed">
                Reads docker-compose, Terraform, Kubernetes manifests,
                Dockerfiles, package manifests and CI config, then adds the
                components and connections it finds. Existing components with
                the same name are reused. Say &quot;undo&quot; in the chat to
                revert an import.
              </p>

              <form onSubmit={submit} className="flex gap-2">
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://github.com/owner/repo"
                  aria-label="Repository URL"
                  autoFocus
                  disabled={busy}
                  className="flex-1 bg-[#1e2235] border border-[#252838] rounded-lg px-3 py-2 text-sm text-[#ccc] placeholder-[#555] focus:outline-none focus:border-[#3b82f6] disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={busy || !url.trim()}
                  className="px-4 py-2 bg-[#3b82f6] text-white rounded-lg text-sm hover:bg-[#2563eb] transition-colors shrink-0 disabled:opacity-40"
                >
                  {busy ? "Reading…" : "Import"}
                </button>
              </form>

              {busy && (
                <p className="text-sm text-[#888]">
                  Fetching files and extracting the model. This can take up to
                  a minute.
                </p>
              )}

              {error && (
                <div className="px-3 py-2 rounded-lg text-sm bg-[#ef4444]/15 text-[#ef4444] border border-[#ef4444]/30">
                  {error}
                </div>
              )}

              {summary && (
                <div className="space-y-3 text-sm">
                  <div className="px-3 py-2 rounded-lg bg-[#10b981]/15 text-[#10b981] border border-[#10b981]/30">
                    Imported {summary.repo}@{summary.ref}:{" "}
                    {summary.createdComponents.length} new component
                    {summary.createdComponents.length === 1 ? "" : "s"},{" "}
                    {summary.createdConnections} new connection
                    {summary.createdConnections === 1 ? "" : "s"}
                  </div>
                  <SummaryList
                    label="New components"
                    items={summary.createdComponents}
                  />
                  <SummaryList
                    label="Reused existing components"
                    items={summary.reusedComponents}
                  />
                  <SummaryList
                    label="Skipped connections"
                    items={summary.skippedConnections.map(
                      (s) => `${s.source} → ${s.target} (${s.reason})`
                    )}
                  />
                  <SummaryList
                    label="Files analysed"
                    items={summary.filesAnalysed}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function SummaryList({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-[#666] mb-1.5">
        {label} ({items.length})
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span
            key={item}
            className="px-2 py-0.5 rounded text-xs bg-[#252838] text-[#aaa] break-all"
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}
