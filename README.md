# Linuxtermial

A private browser-based Linux workspace powered by Vercel Sandbox.

## Current release
- Dark responsive terminal UI
- Isolated Linux microVM command execution
- Signed HTTP-only browser session
- Outbound network denied by default
- Bounded command and output sizes
- Vercel project environment variable: TERMINAL_SESSION_SECRET

## Deployment
This repository is linked to the Vercel project `darth-web-lab`. Pushes to the configured production branch should trigger deployments automatically.

## Safety
The application does not run commands in the Next.js server process. Commands are executed in isolated Vercel Sandbox microVMs. The initial release deliberately exposes a restricted command allowlist and denies outbound network access. Security-testing features and broader networking should only be enabled for targets the operator owns or is explicitly authorized to assess.

## Planned
Full interactive PTY, private file browser, upload/download, and an explicitly scoped CTF/security-tool profile.