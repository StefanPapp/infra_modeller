export const CRITICALITIES = ["High", "Medium", "Low"] as const;
export type Criticality = (typeof CRITICALITIES)[number];

export const STATUSES = ["Active", "Planned", "Deprecated"] as const;
export type ComponentStatus = (typeof STATUSES)[number];

export interface OwnerDetail {
  id: number;
  name: string;
  role: string | null;
  team: string | null;
}

/** A connection as seen from one component: the component on the other end. */
export interface ConnectionRef {
  id: number;
  componentId: number;
  componentName: string;
  componentType: string;
  kind: string;
  protocol: string | null;
  description: string | null;
}

export interface ComponentDetail {
  id: number;
  name: string;
  type: string;
  description: string | null;
  technology: string | null;
  criticality: string | null;
  status: string | null;
  environment: string | null;
  tags: string[];
  url: string | null;
  repoUrl: string | null;
  notes: string | null;
  /** "manual", "seed", or "repo:<owner>/<repo>" */
  source: string;
  lastVerified: string | null;
  owners: OwnerDetail[];
  /** Connections where this component is the source (it depends on / calls the other). */
  outgoing: ConnectionRef[];
  /** Connections where this component is the target (the other depends on / calls it). */
  incoming: ConnectionRef[];
}

export interface GraphNode {
  id: number;
  name: string;
  type: string;
  technology: string | null;
  criticality: string | null;
  status: string | null;
}

export interface GraphLink {
  id: number;
  source: number;
  target: number;
  kind: string;
  protocol: string | null;
}

export interface InfraGraph {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface NewOwnerInput {
  name: string;
  role?: string;
  team?: string;
}

export interface NewComponentInput {
  name: string;
  type: string;
  description?: string;
  technology?: string;
  criticality?: Criticality;
  status?: ComponentStatus;
  environment?: string;
  tags?: string[];
  url?: string;
  repoUrl?: string;
  notes?: string;
  source?: string;
  owners?: NewOwnerInput[];
}

export interface NewConnectionInput {
  kind?: string;
  protocol?: string;
  description?: string;
}

export interface ImportComponent {
  name: string;
  type: string;
  description?: string | null;
  technology?: string | null;
  criticality?: Criticality | null;
  tags?: string[];
}

export interface ImportConnection {
  source: string;
  target: string;
  kind: string;
  protocol?: string | null;
  description?: string | null;
}

export interface ImportModel {
  components: ImportComponent[];
  connections: ImportConnection[];
}

export interface ImportResult {
  createdComponents: string[];
  reusedComponents: string[];
  createdConnections: number;
  skippedConnections: { source: string; target: string; reason: string }[];
}
