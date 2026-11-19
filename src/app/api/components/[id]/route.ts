import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { seedDatabase } from "@/lib/seed";
import { getComponentById } from "@/lib/queries";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const numId = Number(id);

  if (!Number.isInteger(numId) || numId <= 0) {
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  }

  const db = await getDb();
  await seedDatabase(db);
  const component = await getComponentById(db, numId);

  if (!component) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(component);
}
