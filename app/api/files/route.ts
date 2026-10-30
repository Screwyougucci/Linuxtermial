import { Sandbox } from "@vercel/sandbox";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;
const COOKIE = "linuxtermial_session";
const MAX_AGE = 60 * 60 * 24 * 30;
const WORKSPACE = "/vercel/sandbox";
const MAX_FILE_SIZE = 10 * 1024 * 1024;

function signature(id: string) {
  const key = process.env.TERMINAL_SESSION_SECRET;
  if (!key) throw new Error("TERMINAL_SESSION_SECRET is not configured.");
  return createHmac("sha256", key).update(id).digest("hex");
}
function readSession(value?: string): string | null {
  if (!value) return null;
  const [id, sig] = value.split(".");
  if (!id || !sig || !/^[0-9a-f-]{36}$/.test(id) || !/^[0-9a-f]{64}$/.test(sig)) return null;
  const expected = Buffer.from(signature(id), "hex");
  const received = Buffer.from(sig, "hex");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  return id;
}
async function getSandbox(id: string) {
  const name = "lt-" + id;
  let sandbox: Sandbox;
  try {
    sandbox = await Sandbox.get({ name });
  } catch {
    sandbox = await Sandbox.create({
      name,
      timeout: 45 * 60 * 1000,
      persistent: true,
      resources: { vcpus: 1 },
      networkPolicy: "allow-all",
    });
  }
  await sandbox.update({ networkPolicy: "allow-all" });
  return sandbox;
}
function safeName(value: string) {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(value) && value !== "." && value !== ".." && !value.includes("..");
}
async function session() {
  const jar = await cookies();
  let id = readSession(jar.get(COOKIE)?.value);
  const isNew = !id;
  if (!id) id = randomUUID();
  return { id, isNew };
}
function setCookie(response: NextResponse, id: string, isNew: boolean) {
  if (isNew) response.cookies.set(COOKIE, id + "." + signature(id), {
    httpOnly: true, secure: process.env.NODE_ENV === "production",
    sameSite: "strict", path: "/", maxAge: MAX_AGE,
  });
  return response;
}
function originOk(request: NextRequest) {
  return request.headers.get("origin") === new URL(request.url).origin;
}

export async function POST(request: NextRequest) {
  if (!originOk(request)) return NextResponse.json({ error: "Same-origin request required." }, { status: 403 });
  const { id, isNew } = await session();
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
    if (!safeName(file.name)) return NextResponse.json({ error: "Use a simple filename (letters, numbers, dot, dash, underscore)." }, { status: 400 });
    if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "Maximum upload size is 10 MB." }, { status: 413 });
    const sandbox = await getSandbox(id);
    await sandbox.writeFiles([{ path: WORKSPACE + "/" + file.name, content: Buffer.from(await file.arrayBuffer()) }]);
    return setCookie(NextResponse.json({ ok: true, name: file.name, size: file.size }), id, isNew);
  } catch (error) {
    console.error("Linuxtermial file upload error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Upload failed." }, { status: 503 });
  }
}

export async function GET(request: NextRequest) {
  if (!originOk(request)) return NextResponse.json({ error: "Same-origin request required." }, { status: 403 });
  const name = request.nextUrl.searchParams.get("name") || "";
  if (!safeName(name)) return NextResponse.json({ error: "Invalid filename." }, { status: 400 });
  const { id } = await session();
  try {
    const sandbox = await getSandbox(id);
    const buffer = await sandbox.readFileToBuffer({ path: WORKSPACE + "/" + name });
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": 'attachment; filename="' + name + '"',
        "Content-Length": String(buffer.length),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "File not found." }, { status: 404 });
  }
}
