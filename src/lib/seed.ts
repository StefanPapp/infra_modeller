import type { SqlClient } from "./db";
import type { Criticality, NewOwnerInput } from "./types";

interface SeedComponent {
  name: string;
  type: string;
  description: string;
  technology: string;
  criticality: Criticality;
  environment?: string;
  tags: string[];
  url?: string;
  notes?: string;
  owners: NewOwnerInput[];
}

type SeedConnection = [
  source: string,
  target: string,
  kind: string,
  protocol: string | null,
];

/** A fictional e-commerce platform, used as demo data on first load. */
const SEED_COMPONENTS: SeedComponent[] = [
  {
    name: "Storefront Web",
    type: "Frontend",
    description: "Customer-facing web shop",
    technology: "Next.js 16",
    criticality: "High",
    environment: "production",
    tags: ["customer-facing", "ssr"],
    owners: [{ name: "Mira Castellanos", role: "Tech lead", team: "Web" }],
  },
  {
    name: "API Gateway",
    type: "Gateway / Networking",
    description: "Single entry point: routing, auth and rate limiting",
    technology: "Envoy",
    criticality: "High",
    environment: "production",
    tags: ["edge", "auth"],
    owners: [{ name: "Tomasz Bielak", role: "SRE", team: "Platform" }],
  },
  {
    name: "Orders Service",
    type: "Service",
    description: "Order lifecycle: checkout, fulfilment state, refunds",
    technology: "Go 1.26",
    criticality: "High",
    environment: "production",
    tags: ["core-domain"],
    owners: [
      { name: "Priya Raman", role: "Tech lead", team: "Orders" },
      { name: "Jonas Lindqvist", role: "Engineer", team: "Orders" },
    ],
  },
  {
    name: "Catalog Service",
    type: "Service",
    description: "Product catalog, pricing and availability",
    technology: "Python 3.14 / FastAPI",
    criticality: "Medium",
    environment: "production",
    tags: ["core-domain"],
    owners: [{ name: "Aiko Tanabe", role: "Tech lead", team: "Catalog" }],
  },
  {
    name: "Payments Service",
    type: "Service",
    description: "Payment intents, captures and reconciliation",
    technology: "Go 1.26",
    criticality: "High",
    environment: "production",
    tags: ["pci", "core-domain"],
    notes: "In PCI scope. Changes require a security review.",
    owners: [{ name: "Dana Reyes", role: "Tech lead", team: "Payments" }],
  },
  {
    name: "Notification Worker",
    type: "Service",
    description: "Consumes order events and sends transactional email",
    technology: "Node.js 24",
    criticality: "Low",
    environment: "production",
    tags: ["async", "worker"],
    owners: [{ name: "Jonas Lindqvist", role: "Engineer", team: "Orders" }],
  },
  {
    name: "Orders DB",
    type: "Database",
    description: "System of record for orders and payments",
    technology: "PostgreSQL 18",
    criticality: "High",
    environment: "production",
    tags: ["stateful", "pii"],
    notes: "Primary + one read replica. PITR enabled, 14 day retention.",
    owners: [{ name: "Tomasz Bielak", role: "SRE", team: "Platform" }],
  },
  {
    name: "Catalog Search",
    type: "Database",
    description: "Full-text product search index",
    technology: "OpenSearch",
    criticality: "Medium",
    environment: "production",
    tags: ["stateful", "search"],
    owners: [{ name: "Aiko Tanabe", role: "Tech lead", team: "Catalog" }],
  },
  {
    name: "Session Cache",
    type: "Cache",
    description: "Sessions, rate-limit counters and catalog read-through cache",
    technology: "Redis",
    criticality: "Medium",
    environment: "production",
    tags: ["ephemeral"],
    owners: [{ name: "Tomasz Bielak", role: "SRE", team: "Platform" }],
  },
  {
    name: "Event Bus",
    type: "Queue / Messaging",
    description: "Domain events between services",
    technology: "Apache Kafka",
    criticality: "High",
    environment: "production",
    tags: ["async", "stateful"],
    owners: [{ name: "Tomasz Bielak", role: "SRE", team: "Platform" }],
  },
  {
    name: "Media Bucket",
    type: "Storage",
    description: "Product images and generated invoices",
    technology: "S3",
    criticality: "Low",
    environment: "production",
    tags: ["object-storage"],
    owners: [{ name: "Aiko Tanabe", role: "Tech lead", team: "Catalog" }],
  },
  {
    name: "Stripe",
    type: "External SaaS",
    description: "Card processing and payouts",
    technology: "Stripe API",
    criticality: "High",
    tags: ["third-party", "pci"],
    url: "https://stripe.com",
    owners: [{ name: "Dana Reyes", role: "Vendor owner", team: "Payments" }],
  },
  {
    name: "SendGrid",
    type: "External SaaS",
    description: "Transactional email delivery",
    technology: "SendGrid API",
    criticality: "Low",
    tags: ["third-party", "email"],
    url: "https://sendgrid.com",
    owners: [{ name: "Jonas Lindqvist", role: "Vendor owner", team: "Orders" }],
  },
  {
    name: "Kubernetes Cluster",
    type: "Infrastructure",
    description: "Runtime for all first-party services",
    technology: "GKE",
    criticality: "High",
    environment: "production",
    tags: ["compute"],
    owners: [{ name: "Tomasz Bielak", role: "SRE", team: "Platform" }],
  },
  {
    name: "Deploy Pipeline",
    type: "CI/CD",
    description: "Build, test and progressive rollout",
    technology: "GitHub Actions + Argo CD",
    criticality: "Medium",
    tags: ["delivery"],
    owners: [{ name: "Tomasz Bielak", role: "SRE", team: "Platform" }],
  },
  {
    name: "Metrics Stack",
    type: "Observability",
    description: "Metrics, dashboards and alerting",
    technology: "Prometheus + Grafana",
    criticality: "Medium",
    environment: "production",
    tags: ["monitoring"],
    owners: [{ name: "Tomasz Bielak", role: "SRE", team: "Platform" }],
  },
];

const SEED_CONNECTIONS: SeedConnection[] = [
  ["Storefront Web", "API Gateway", "calls", "HTTPS"],
  ["API Gateway", "Orders Service", "routes to", "gRPC"],
  ["API Gateway", "Catalog Service", "routes to", "HTTP"],
  ["API Gateway", "Payments Service", "routes to", "gRPC"],
  ["API Gateway", "Session Cache", "reads/writes", "RESP"],
  ["Orders Service", "Orders DB", "reads/writes", "SQL"],
  ["Orders Service", "Payments Service", "calls", "gRPC"],
  ["Orders Service", "Event Bus", "publishes to", "Kafka"],
  ["Payments Service", "Orders DB", "reads/writes", "SQL"],
  ["Payments Service", "Stripe", "calls", "HTTPS"],
  ["Catalog Service", "Catalog Search", "reads/writes", "HTTP"],
  ["Catalog Service", "Session Cache", "reads/writes", "RESP"],
  ["Catalog Service", "Media Bucket", "reads/writes", "S3"],
  ["Storefront Web", "Media Bucket", "reads", "HTTPS"],
  ["Notification Worker", "Event Bus", "consumes from", "Kafka"],
  ["Notification Worker", "SendGrid", "calls", "HTTPS"],
  ["Orders Service", "Kubernetes Cluster", "runs on", null],
  ["Catalog Service", "Kubernetes Cluster", "runs on", null],
  ["Payments Service", "Kubernetes Cluster", "runs on", null],
  ["Notification Worker", "Kubernetes Cluster", "runs on", null],
  ["API Gateway", "Kubernetes Cluster", "runs on", null],
  ["Deploy Pipeline", "Kubernetes Cluster", "deploys to", "HTTPS"],
  ["Metrics Stack", "Kubernetes Cluster", "scrapes", "HTTP"],
];

export async function seedDatabase(db: SqlClient): Promise<void> {
  const counts = await db.query<{ count: string | number }>(
    "SELECT COUNT(*) AS count FROM components"
  );
  if (Number(counts[0].count) > 0) return;

  await db.transaction(async (tx) => {
    const ids = new Map<string, number>();

    for (const c of SEED_COMPONENTS) {
      const inserted = await tx.query<{ id: number }>(
        `INSERT INTO components
           (name, type, description, technology, criticality, status,
            environment, tags, url, notes, source)
         VALUES ($1, $2, $3, $4, $5, 'Active', $6, $7, $8, $9, 'seed')
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [
          c.name,
          c.type,
          c.description,
          c.technology,
          c.criticality,
          c.environment ?? null,
          JSON.stringify(c.tags),
          c.url ?? null,
          c.notes ?? null,
        ]
      );
      // A concurrent first request may have seeded already.
      if (inserted.length === 0) return;
      ids.set(c.name, inserted[0].id);

      for (const owner of c.owners) {
        await tx.query(
          "INSERT INTO component_owners (component_id, name, role, team) VALUES ($1, $2, $3, $4)",
          [inserted[0].id, owner.name, owner.role ?? null, owner.team ?? null]
        );
      }
    }

    for (const [source, target, kind, protocol] of SEED_CONNECTIONS) {
      await tx.query(
        "INSERT INTO connections (source_id, target_id, kind, protocol) VALUES ($1, $2, $3, $4)",
        [ids.get(source), ids.get(target), kind, protocol]
      );
    }
  });
}
