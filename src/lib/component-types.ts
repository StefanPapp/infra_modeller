/** Known component types and their colours. Other types are allowed and fall back to FALLBACK_COLOR. */
export const TYPE_COLORS: Record<string, string> = {
  Service: "#3b82f6",
  Frontend: "#22d3ee",
  Database: "#10b981",
  Cache: "#f97316",
  "Queue / Messaging": "#f59e0b",
  Storage: "#84cc16",
  "Gateway / Networking": "#8b5cf6",
  "External SaaS": "#ec4899",
  "CI/CD": "#a3a3a3",
  Observability: "#eab308",
  Infrastructure: "#ef4444",
};

export const COMPONENT_TYPES = Object.keys(TYPE_COLORS);

export const FALLBACK_COLOR = "#64748b";

export function typeColor(type: string): string {
  return TYPE_COLORS[type] ?? FALLBACK_COLOR;
}

/** Suggested connection kinds, read as "<source> <kind> <target>". */
export const CONNECTION_KINDS = [
  "calls",
  "reads/writes",
  "reads",
  "publishes to",
  "consumes from",
  "routes to",
  "runs on",
  "deploys to",
  "depends on",
];
