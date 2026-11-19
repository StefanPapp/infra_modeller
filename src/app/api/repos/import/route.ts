import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { seedDatabase } from "@/lib/seed";
import { importRepository } from "@/lib/repo/import";
import { defaultImportDeps } from "@/lib/repo/defaults";
import { RepoFetchError, type RepoFetchErrorKind } from "@/lib/repo/github";

// Fetching the repository and running the extraction can take a while.
export const maxDuration = 300;

const bodySchema = z.object({ url: z.string().trim().min(1).max(300) });

const STATUS_BY_KIND: Record<RepoFetchErrorKind, number> = {
  not_found: 404,
  unauthorized: 502,
  rate_limited: 429,
  upstream: 502,
};

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const db = await getDb();
  await seedDatabase(db);

  try {
    const result = await importRepository(
      db,
      parsed.data.url,
      defaultImportDeps()
    );
    if ("error" in result) {
      return NextResponse.json(result, { status: 422 });
    }
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof RepoFetchError) {
      return NextResponse.json(
        { error: err.message },
        { status: STATUS_BY_KIND[err.kind] }
      );
    }
    console.error("repository import failed", err);
    return NextResponse.json(
      { error: "Repository import failed. Check the AI provider API key and server logs." },
      { status: 500 }
    );
  }
}
