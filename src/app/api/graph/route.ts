import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { seedDatabase } from "@/lib/seed";
import { getGraph } from "@/lib/queries";

export async function GET() {
  const db = await getDb();
  await seedDatabase(db);
  return NextResponse.json(await getGraph(db));
}
