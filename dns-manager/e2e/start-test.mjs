#!/usr/bin/env node
/**
 * Starts the mock bridge on :8650, the Next.js prod server on :10010,
 * runs Playwright tests, and cleans up. Used by `npm run test:e2e`.
 *
 * Requires: npm run build has been run first.
 */
import http from "http";
import { spawn } from "child_process";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const load = (name) => JSON.parse(readFileSync(join(__dirname, "fixtures", name + ".json"), "utf-8"));

const health = load("health");
const connect = load("connect");
const zones = load("zones");
const policies = load("policies");
const records = load("records");

// ── Start mock bridge on :8650 ──
const bridge = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  const u = req.url || "";
  let b = { success: true };
  if (u.includes("/api/health")) b = health;
  else if (u.includes("/api/connect")) b = connect;
  else if (/\/api\/zones\/[^/]+\/records/.test(u)) b = records;
  else if (u.includes("/api/zones") && !u.includes("zonescopes")) {
    if (req.method === "GET" && /\/api\/zones\/[^/]+$/.test(u)) b = { success: true, zone: zones.zones[0] };
    else if (req.method === "GET") b = zones;
  }
  else if (u.includes("/api/policies") && req.method === "GET") b = policies;
  else if (u.includes("/api/transferpolicies")) b = { success: true, policies: [] };
  else if (u.includes("/api/subnets")) b = { success: true, subnets: [] };
  else if (u.includes("/api/zonescopes")) b = { success: true, scopes: [] };
  else if (u.includes("/api/recursionscopes")) b = { success: true, scopes: [] };
  else if (u.includes("/api/credentials")) b = { success: true, exists: false };
  else if (u.includes("/api/dnssec")) b = { success: true, settings: {}, keys: [] };
  else if (u.includes("/api/trustanchors")) b = { success: true, anchors: [] };
  else if (u.includes("/api/trustpoints")) b = { success: true, points: [] };
  else if (u.includes("/api/utilities/dns-lookup")) b = { success: true, output: "Server:  localhost\nAddress:  127.0.0.1\n\nName:    example.com\nAddress: 93.184.216.34\n", command: "Resolve-DnsName -Name 'example.com' -Type A" };
  res.writeHead(200);
  res.end(JSON.stringify(b));
});

await new Promise((r) => bridge.listen(8650, "127.0.0.1", r));
console.log("Mock bridge started on :8650");

// ── Start Next.js production server on :10010 ──
const nextServer = spawn("node", ["node_modules/next/dist/bin/next", "start", "--port", "10010"], {
  cwd: join(__dirname, ".."),
  stdio: "pipe",
});

// Wait for server to be ready
await new Promise((resolve) => {
  nextServer.stdout.on("data", (data) => {
    const text = data.toString();
    if (text.includes("Ready") || text.includes("started")) resolve();
  });
  setTimeout(resolve, 5000); // fallback
});
console.log("Next.js server started on :10010");

// ── Run Playwright ──
const pw = spawn("npx", ["playwright", "test", "--reporter=line"], {
  cwd: join(__dirname, ".."),
  stdio: "inherit",
  shell: true,
});

const exitCode = await new Promise((resolve) => pw.on("close", resolve));

// ── Cleanup ──
nextServer.kill();
bridge.close();
process.exit(exitCode);
