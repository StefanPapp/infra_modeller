# Infra Modeller

An interactive map of IT infrastructure. Components (services, frontends,
databases, queues, caches, gateways, external SaaS, CI/CD, platforms) are nodes
in a force-directed graph; the dependencies between them are directed, labelled
connections.

## Features

- **Graph view** - d3 force layout, clustered and coloured by component type.
  Hover or select a node to highlight its neighbours and connection labels.
- **Connections** - directed `source -> target` links with a kind
  (`calls`, `reads/writes`, `publishes to`, ...) and an optional protocol.
  Create and remove them from the detail panel or through the chat.
- **Repository import** - give a GitHub URL; the server fetches
  infrastructure-relevant files through the GitHub API and an LLM extracts
  components and connections. Components that already exist by name are
  reused, so several repositories merge into one model.
- **Assistant** - a chatbot that answers questions about the model and edits
  it: add / update / rename / delete components, connect / disconnect, manage
  owners, import repositories, search the web, undo the last change.
- **Owners** - people and teams responsible for a component.

## Getting started

```bash
bun install
cp .env.example .env.local   # fill in an LLM key at least
bun dev
```

Open http://localhost:3000. Without `DATABASE_URL` the dev server uses an
in-memory database that is seeded with a fictional e-commerce platform and
reset on restart. Production requires `DATABASE_URL`.

| Variable | Required | Purpose |
|---|---|---|
| `GOOGLE_GENERATIVE_AI_API_KEY` | one of the two | Gemini for chat and repository extraction (used when set) |
| `ANTHROPIC_API_KEY` | one of the two | Claude, used when no Google key is set |
| `AI_PROVIDER` | no | Force `google` or `anthropic` |
| `GEMINI_MODEL` | no | Model override (default `gemini-2.5-flash`) |
| `APP_PASSWORD` | production | Shared login password (HTTP Basic auth) |
| `APP_USERNAME` | no | Login user name (default `admin`) |
| `DATABASE_URL` | production | Postgres (Neon) connection string |
| `GITHUB_TOKEN` | no | Private repositories, higher GitHub rate limit |
| `FIRECRAWL_API_KEY` | no | Chatbot web search |
| `ANTHROPIC_MODEL` | no | Model override (default `claude-sonnet-5-5`) |

## Scripts

```bash
bun dev             # dev server
bun run test        # unit tests (vitest, in-memory Postgres via PGlite)
bun run typecheck   # tsc --noEmit
bun lint            # eslint
bun run build       # production build
```

## How repository import works

1. `parseRepoUrl` accepts only `github.com/<owner>/<repo>` references (URL,
   SSH form, or `owner/repo`, optionally `/tree/<ref>`). Nothing else is ever
   fetched.
2. `fetchRepoSnapshot` reads the repository tree and downloads up to 25 files,
   ranked: compose files, Terraform / Kubernetes / platform config,
   Dockerfiles and `.env.example`, package manifests, CI config, root README.
   Files are capped at 12 kB each and 120 kB in total.
3. Files that typically hold credentials are never downloaded: `.env*`
   (except templates), `*.tfvars`, Terraform state, key material, and any
   path containing `secret` or `credential`.
4. `extractInfraModel` sends the files to the configured LLM and receives a
   schema-validated list of components and connections.
5. `importModel` merges that into the database in one transaction; `undo`
   reverts the whole import.

Selected file contents are sent to the configured LLM provider (Google or
Anthropic). On Gemini's free tier Google may use submitted content to improve
its products. Do not import
repositories whose deployment descriptors you are not allowed to share.

## Layout

```
src/app/api/graph                GET   nodes + links
src/app/api/components/[id]      GET   component detail
src/app/api/connections          POST  create connection
src/app/api/connections/[id]     DELETE
src/app/api/repos/import         POST  import a GitHub repository
src/app/api/chat                 POST  assistant (AI SDK tool calling)
src/proxy.ts                     Basic auth for pages and API
src/lib/db.ts                    schema + Neon client
src/lib/queries.ts, mutations.ts data access, single-step undo
src/lib/repo/                    GitHub fetch, extraction, import orchestration
src/components/                  graph, detail panel, chat, dialogs
```

## Known limitations

- Authentication is a single shared credential (HTTP Basic auth, enforced in
  `src/proxy.ts`). There are no per-user accounts, roles or audit trail, and
  Basic auth has no logout. Serve it over HTTPS only.
- Only GitHub is supported as a repository host.
- Undo is single-step.
