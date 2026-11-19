import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { connectComponents } from "@/lib/mutations";

const bodySchema = z.object({
  source: z.string().trim().min(1).max(120),
  target: z.string().trim().min(1).max(120),
  kind: z.string().trim().min(1).max(40).optional(),
  protocol: z.string().trim().min(1).max(40).optional(),
  description: z.string().trim().min(1).max(300).optional(),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { source, target, ...input } = parsed.data;

  const db = await getDb();
  const result = await connectComponents(db, source, target, input);
  if ("error" in result) {
    const status = result.error.endsWith("not found") ? 404 : 409;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json(result, { status: 201 });
}
