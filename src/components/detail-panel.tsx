"use client";

import { useState } from "react";
import type { ComponentDetail, ConnectionRef, GraphNode } from "@/lib/types";
import { CONNECTION_KINDS, typeColor } from "@/lib/component-types";

const LEVEL_COLORS: Record<string, string> = {
  High: "#ef4444",
  Medium: "#f59e0b",
  Low: "#10b981",
  Active: "#10b981",
  Planned: "#3b82f6",
  Deprecated: "#888",
};

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffSec = Math.round((Date.now() - then) / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? "" : "s"} ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? "" : "s"} ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
  const diffMo = Math.round(diffDay / 30);
  if (diffMo < 12) return `${diffMo} month${diffMo === 1 ? "" : "s"} ago`;
  const diffYr = Math.round(diffMo / 12);
  return `${diffYr} year${diffYr === 1 ? "" : "s"} ago`;
}

/** Only http(s) URLs are rendered as links; anything else is shown as text. */
function safeHref(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

interface DetailPanelProps {
  component: ComponentDetail | null;
  /** All components on the map, used as connection targets. */
  components: GraphNode[];
  onClose: () => void;
  onSelectComponent: (componentId: number) => void;
  /** Called after a connection was added or removed. */
  onChanged: () => void;
}

export function DetailPanel({
  component,
  components,
  onClose,
  onSelectComponent,
  onChanged,
}: DetailPanelProps) {
  if (!component) return null;

  const color = typeColor(component.type);

  return (
    <div className="w-[380px] shrink-0 bg-[#161822] border-l border-[#252838] flex flex-col overflow-y-auto">
      <div className="p-5 border-b border-[#252838] relative">
        <button
          onClick={onClose}
          aria-label="Close details"
          className="absolute top-4 right-4 text-[#666] hover:text-white text-xl leading-none"
        >
          x
        </button>
        <h2 className="text-xl font-semibold text-white pr-8 break-words">
          {component.name}
        </h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span
            className="inline-block px-3 py-1 rounded-full text-xs font-medium"
            style={{ backgroundColor: `${color}20`, color }}
          >
            {component.type}
          </span>
          {component.technology && (
            <span className="text-xs text-[#aaa]">{component.technology}</span>
          )}
        </div>
      </div>

      <div className="p-5 space-y-5">
        {component.description && (
          <Field label="Description" value={component.description} />
        )}

        <div className="flex gap-6">
          {component.criticality && (
            <Badge label="Criticality" value={component.criticality} />
          )}
          {component.status && (
            <Badge label="Status" value={component.status} />
          )}
          {component.environment && (
            <Field label="Environment" value={component.environment} />
          )}
        </div>

        <ConnectionList
          label="Depends on / calls"
          empty="No outgoing connections."
          arrow="→"
          connections={component.outgoing}
          onSelectComponent={onSelectComponent}
          onChanged={onChanged}
        />

        <ConnectionList
          label="Used by"
          empty="Nothing depends on this component."
          arrow="←"
          connections={component.incoming}
          onSelectComponent={onSelectComponent}
          onChanged={onChanged}
        />

        <AddConnectionForm
          key={component.id}
          component={component}
          components={components}
          onChanged={onChanged}
        />

        {component.owners.length > 0 && (
          <div>
            <Label>Owners</Label>
            <ul className="space-y-2">
              {component.owners.map((owner) => (
                <li
                  key={owner.id}
                  className="p-3 rounded-lg bg-[#1e2235] flex items-center gap-2"
                >
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold text-white shrink-0"
                    style={{ backgroundColor: color }}
                  >
                    {getInitials(owner.name)}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm text-[#ccc]">{owner.name}</div>
                    {(owner.role || owner.team) && (
                      <div className="text-xs text-[#888] truncate">
                        {[owner.role, owner.team].filter(Boolean).join(" · ")}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {component.tags.length > 0 && (
          <div>
            <Label>Tags</Label>
            <div className="flex flex-wrap gap-1.5">
              {component.tags.map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-0.5 rounded text-xs bg-[#252838] text-[#aaa]"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {component.repoUrl && (
          <LinkField label="Repository" url={component.repoUrl} />
        )}
        {component.url && <LinkField label="Link" url={component.url} />}
        {component.notes && <Field label="Notes" value={component.notes} />}

        <div className="text-[11px] text-[#666] space-y-0.5">
          {component.source.startsWith("repo:") && (
            <p>Imported from {component.source.slice("repo:".length)}</p>
          )}
          {component.lastVerified && (
            <p title={component.lastVerified}>
              Last verified {formatRelative(component.lastVerified)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function ConnectionList({
  label,
  empty,
  arrow,
  connections,
  onSelectComponent,
  onChanged,
}: {
  label: string;
  empty: string;
  arrow: string;
  connections: ConnectionRef[];
  onSelectComponent: (componentId: number) => void;
  onChanged: () => void;
}) {
  const [removing, setRemoving] = useState<number | null>(null);

  const remove = async (connectionId: number) => {
    setRemoving(connectionId);
    try {
      await fetch(`/api/connections/${connectionId}`, { method: "DELETE" });
      onChanged();
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div>
      <Label>
        {label} ({connections.length})
      </Label>
      {connections.length === 0 ? (
        <p className="text-xs text-[#666]">{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {connections.map((c) => (
            <li
              key={c.id}
              className="group px-3 py-2 rounded-lg bg-[#1e2235] flex items-center gap-2"
              title={c.description ?? undefined}
            >
              <span className="text-[#666] text-xs shrink-0">{arrow}</span>
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: typeColor(c.componentType) }}
              />
              <button
                onClick={() => onSelectComponent(c.componentId)}
                className="text-sm text-[#ccc] hover:text-white hover:underline truncate text-left"
              >
                {c.componentName}
              </button>
              <span className="ml-auto text-[10px] text-[#888] shrink-0">
                {c.protocol ? `${c.kind} · ${c.protocol}` : c.kind}
              </span>
              <button
                onClick={() => remove(c.id)}
                disabled={removing === c.id}
                aria-label={`Remove connection to ${c.componentName}`}
                title="Remove connection"
                className="text-[#555] hover:text-[#ef4444] text-sm leading-none shrink-0 disabled:opacity-40"
              >
                x
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AddConnectionForm({
  component,
  components,
  onChanged,
}: {
  component: ComponentDetail;
  components: GraphNode[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState<"outgoing" | "incoming">(
    "outgoing"
  );
  const [other, setOther] = useState("");
  const [kind, setKind] = useState("calls");
  const [protocol, setProtocol] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidates = components
    .filter((c) => c.id !== component.id)
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        disabled={candidates.length === 0}
        className="w-full px-4 py-2 text-sm rounded-lg bg-[#252838] text-[#3b82f6] hover:bg-[#3b82f6] hover:text-white transition-colors disabled:opacity-40"
      >
        + Add connection
      </button>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!other) return;
    setBusy(true);
    setError(null);
    try {
      const [source, target] =
        direction === "outgoing"
          ? [component.name, other]
          : [other, component.name];
      const res = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source,
          target,
          kind: kind.trim() || undefined,
          protocol: protocol.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body: { error?: string } = await res.json().catch(() => ({}));
        setError(body.error ?? "Could not create the connection");
        return;
      }
      setOther("");
      setProtocol("");
      setOpen(false);
      onChanged();
    } catch {
      setError("Could not reach the server");
    } finally {
      setBusy(false);
    }
  };

  const inputClass =
    "w-full bg-[#161822] border border-[#252838] rounded-lg px-2.5 py-1.5 text-sm text-[#ccc] placeholder-[#555] focus:outline-none focus:border-[#3b82f6]";

  return (
    <form
      onSubmit={submit}
      className="p-3 rounded-lg bg-[#1e2235] border border-[#252838] space-y-2"
    >
      <Label>New connection</Label>
      <select
        value={direction}
        onChange={(e) =>
          setDirection(e.target.value as "outgoing" | "incoming")
        }
        aria-label="Direction"
        className={inputClass}
      >
        <option value="outgoing">{component.name} → other component</option>
        <option value="incoming">other component → {component.name}</option>
      </select>
      <select
        value={other}
        onChange={(e) => setOther(e.target.value)}
        aria-label="Other component"
        required
        className={inputClass}
      >
        <option value="">Select component…</option>
        {candidates.map((c) => (
          <option key={c.id} value={c.name}>
            {c.name} ({c.type})
          </option>
        ))}
      </select>
      <div className="flex gap-2">
        <input
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          list="connection-kinds"
          placeholder="Kind, e.g. calls"
          aria-label="Kind"
          maxLength={40}
          className={inputClass}
        />
        <datalist id="connection-kinds">
          {CONNECTION_KINDS.map((k) => (
            <option key={k} value={k} />
          ))}
        </datalist>
        <input
          value={protocol}
          onChange={(e) => setProtocol(e.target.value)}
          placeholder="Protocol"
          aria-label="Protocol"
          maxLength={40}
          className={inputClass}
        />
      </div>
      {error && <p className="text-xs text-[#ef4444]">{error}</p>}
      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={busy || !other}
          className="flex-1 px-3 py-1.5 text-sm rounded-lg bg-[#3b82f6] text-white hover:bg-[#2563eb] transition-colors disabled:opacity-40"
        >
          {busy ? "Connecting…" : "Connect"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="px-3 py-1.5 text-sm rounded-lg bg-[#252838] text-[#aaa] hover:text-white transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] uppercase tracking-wider text-[#666] mb-1.5">
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="text-sm text-[#ccc] leading-relaxed">{value}</div>
    </div>
  );
}

function Badge({ label, value }: { label: string; value: string }) {
  const color = LEVEL_COLORS[value] ?? "#888";
  return (
    <div>
      <Label>{label}</Label>
      <span
        className="inline-block px-3 py-1 rounded-full text-xs"
        style={{ backgroundColor: `${color}26`, color }}
      >
        {value}
      </span>
    </div>
  );
}

function LinkField({ label, url }: { label: string; url: string }) {
  const href = safeHref(url);
  return (
    <div>
      <Label>{label}</Label>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-[#3b82f6] hover:underline break-all"
        >
          {url}
        </a>
      ) : (
        <span className="text-sm text-[#ccc] break-all">{url}</span>
      )}
    </div>
  );
}
