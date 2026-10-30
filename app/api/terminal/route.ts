import { Sandbox } from "@vercel/sandbox";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;
const COOKIE = "linuxtermial_session";
const MAX_AGE = 60 * 60 * 24 * 30;

function secret() {
  const value = process.env.TERMINAL_SESSION_SECRET;
  if (!value) throw new Error("TERMINAL_SESSION_SECRET is not configured.");
  return value;
}
function signature(id: string) {
  return createHmac("sha256", secret()).update(id).digest("hex");
}
function readSession(value?: string): string | null {
  if (!value) return null;
  const [id, sig] = value.split(".");
  if (!id || !sig || !/^[0-9a-f-]{36}$/.test(id)) return null;
  const expected = Buffer.from(signature(id), "hex");
  const received = Buffer.from(sig, "hex");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  return id;
}
async function sandboxFor(id: string) {
  const name = "lt-" + id;
  try {
    return await Sandbox.get({ name });
  } catch {
    return await Sandbox.create({
      name,
      timeout: 45 * 60 * 1000,
      persistent: true,
      resources: { vcpus: 1 },
      networkPolicy: "deny-all"
    });
  }
}

// Intentionally limited in this first release: no shell interpreter, chaining,
// arbitrary scripts, package installation, or network-capable commands.
function parseAllowed(input: string): { cmd: string; args: string[] } | null {
  const parts = input.trim().split(/\s+/);
  const cmd = parts[0];
  const args = parts.slice(1);
  const allowed: Record<string, string[]> = {
    pwd: [],
    whoami: [],
    id: [],
    date: [],
    uname: ["-a", "-s", "-r", "-m"],
    ls: ["-l", "-a", "-la", "-al"],
    df: ["-h"],
    free: ["-h"],
    "python3": ["--version"],
    node: ["--version"]
  };
  if (!Object.prototype.hasOwnProperty.call(allowed, cmd)) return null;
  if (args.some((arg) => !allowed[cmd].includes(arg))) return null;
  if (args.length > 1 && cmd !== "ls") return null;
  return { cmd, args };
}

export async function GET() {
  return NextResponse.json({ status: "ready", provider: "Vercel Sandbox", network: "denied" });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Cross-origin requests are not allowed." }, { status: 403 });
  }
  let body: { command?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON request." }, { status: 400 }); }
  if (typeof body.command !== "string" || !body.command.trim() || body.command.length > 160) {
    return NextResponse.json({ error: "Enter a command under 160 characters." }, { status: 400 });
  }
  const parsed = parseAllowed(body.command);
  if (!parsed) {
    return NextResponse.json({
      error: "That command is not enabled yet. Type help for the supported command list. Shell chaining, scripts, package installs, and network commands are disabled in this first release."
    }, { status: 400 });
  }

  try {
    const jar = await cookies();
    let id = readSession(jar.get(COOKIE)?.value);
    const isNew = !id;
    if (!id) id = randomUUID();
    const sandbox = await sandboxFor(id);
    const result = await sandbox.runCommand({ cmd: parsed.cmd, args: parsed.args });
    const output = (await result.stdout()).slice(0, 12000);
    const response = NextResponse.json({
      output: output || "(no output)",
      exitCode: result.exitCode,
      sandbox: "isolated"
    });
    if (isNew) {
      response.cookies.set(COOKIE, id + "." + signature(id), {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: MAX_AGE
      });
    }
    return response;
  } catch (error) {
    console.error("Linuxtermial sandbox error:", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Sandbox unavailable."
    }, { status: 503 });
  }
}
