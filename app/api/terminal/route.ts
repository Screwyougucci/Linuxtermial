import { Sandbox } from "@vercel/sandbox";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;
const COOKIE = "linuxtermial_session";
const MAX_AGE = 60 * 60 * 24 * 30;
const WORKSPACE = "/vercel/sandbox";

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
  if (!id || !sig || !/^[0-9a-f-]{36}$/.test(id) || !/^[0-9a-f]{64}$/.test(sig)) return null;
  const expected = Buffer.from(signature(id), "hex");
  const received = Buffer.from(sig, "hex");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  return id;
}
async function sandboxFor(id: string) {
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
      networkPolicy: "allow-all"
    });
  }
  await sandbox.update({ networkPolicy: "allow-all" });
  return sandbox;
}

// No shell is invoked. File paths are restricted to simple names in /vercel/sandbox.
function safeWorkspacePath(value: string) {
  return /^[A-Za-z0-9_.-]{1,80}$/.test(value) && value !== "." && value !== ".." && !value.includes("..");
}
function parseAllowed(input: string): { cmd: string; args: string[] } | null {
  const parts = input.trim().split(/\s+/);
  const cmd = parts[0];
  const args = parts.slice(1);
  const noArgs = ["pwd", "whoami", "id", "date", "hostname", "uptime"];
  const fixedArgs: Record<string, string[]> = {
    uname: ["-a", "-s", "-r", "-m"],
    df: ["-h"],
    free: ["-h"],
    python3: ["--version"],
    node: ["--version"],
    git: ["--version"],
    ls: ["-l", "-a", "-la", "-al"]
  };
  if (noArgs.includes(cmd) && args.length === 0) return { cmd, args };
  if (fixedArgs[cmd] && args.length > 0 && args.length <= 2) {
    if (cmd === "ls") {
      const valid = args.every((arg) => fixedArgs.ls.includes(arg) || safeWorkspacePath(arg));
      if (valid && (!args.some((arg) => fixedArgs.ls.includes(arg)) || args.filter((arg) => safeWorkspacePath(arg)).length <= 1)) return { cmd, args };
    } else if (args.length === 1 && fixedArgs[cmd].includes(args[0])) return { cmd, args };
  }

  // HTTPS-only network probes/downloads. No shell is invoked and URL arguments
  // are passed directly to the executable.
  if (cmd === "curl" && args.length === 2 && ["-I", "-L"].includes(args[0])) {
    try {
      const url = new URL(args[1]);
      if (url.protocol === "https:" && !url.username && !url.password && !/^(localhost|127\\.|10\\.|192\\.168\\.|172\\.(1[6-9]|2[0-9]|3[01])\\.|169\\.254\\.)/i.test(url.hostname)) {
        return { cmd, args: ["--max-time", "15", args[0], url.toString()] };
      }
    } catch {}
  }
  if (cmd === "wget" && args.length === 1) {
    try {
      const url = new URL(args[0]);
      if (url.protocol === "https:" && !url.username && !url.password && !/^(localhost|127\\.|10\\.|192\\.168\\.|172\\.(1[6-9]|2[0-9]|3[01])\\.|169\\.254\\.)/i.test(url.hostname)) {
        return { cmd, args: ["--timeout=15", "--", url.toString()] };
      }
    } catch {}
  }
  if (["cat", "touch", "mkdir", "head", "tail", "wc"].includes(cmd) && args.length === 1 && safeWorkspacePath(args[0])) {
    return { cmd, args };
  }
  return null;
}

export async function GET() {
  return NextResponse.json({ status: "ready", provider: "Vercel Sandbox", network: "enabled" });
}

export async function POST(request: NextRequest) {
  const expectedOrigin = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  if (origin !== expectedOrigin) {
    return NextResponse.json({ error: "A same-origin browser request is required." }, { status: 403 });
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "Content-Type must be application/json." }, { status: 415 });
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
      error: "Command not enabled. Try help. Shell chaining, scripts, package installs, absolute paths, and network commands are disabled."
    }, { status: 400 });
  }

  try {
    const jar = await cookies();
    let id = readSession(jar.get(COOKIE)?.value);
    const isNew = !id;
    if (!id) id = randomUUID();
    const sandbox = await sandboxFor(id);
    const result = await sandbox.runCommand({ cmd: parsed.cmd, args: parsed.args, cwd: WORKSPACE });
    const output = (await result.stdout()).slice(0, 12000);
    const stderr = (await result.stderr()).slice(0, 3000);
    const response = NextResponse.json({
      output: [output, stderr].filter(Boolean).join("\n") || "(no output)",
      exitCode: result.exitCode,
      sandbox: "isolated",
      workspace: WORKSPACE
    });
    if (isNew) {
      response.cookies.set(COOKIE, id + "." + signature(id), {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
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
