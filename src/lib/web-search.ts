import FirecrawlApp from "@mendable/firecrawl-js";

export interface WebSearchResult {
  title: string;
  url: string;
  description: string;
  content: string;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Searches the web via Firecrawl. Returns an error object when not configured. */
export async function webSearch(
  query: string,
  limit = 5
): Promise<{ results: WebSearchResult[] } | { error: string }> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) return { error: "FIRECRAWL_API_KEY not configured" };

  const firecrawl = new FirecrawlApp({ apiKey });
  const data = await firecrawl.search(query, { limit });
  const entries: unknown[] = data.web ?? [];

  const results = entries.map((entry) => {
    const r = (entry ?? {}) as Record<string, unknown>;
    const metadata = (r.metadata ?? {}) as Record<string, unknown>;
    return {
      title: str(r.title) || str(metadata.title),
      url: str(r.url) || str(metadata.sourceURL),
      description: str(r.description) || str(metadata.description),
      content: str(r.markdown).slice(0, 500),
    };
  });

  return results.length > 0 ? { results } : { error: "No results found" };
}
