import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const apiDir = path.join(root, "api");
const isVercel = process.env.VERCEL === "1" || process.env.VERCEL === "true" || process.env.FORCE_VERCEL_CLEANUP === "1";

const allowedApiFiles = new Set([
  "actions.js",
  "articles.js",
  "declare-payment.js",
  "event-registrations.js",
  "payment-declarations.js",
  "public-events.js",
  "register-event.js",
  "site-content.js",
]);

if (!isVercel) {
  console.log("[vercel-prebuild] Local build: source cleanup skipped.");
  process.exit(0);
}

if (!fs.existsSync(apiDir)) {
  throw new Error("[vercel-prebuild] Missing /api directory.");
}

let removed = 0;
for (const entry of fs.readdirSync(apiDir, { withFileTypes: true })) {
  const fullPath = path.join(apiDir, entry.name);

  if (entry.isFile() && /\.(?:js|mjs|cjs|ts)$/.test(entry.name) && !allowedApiFiles.has(entry.name)) {
    fs.rmSync(fullPath, { force: true });
    removed += 1;
    console.log(`[vercel-prebuild] Removed stale API function: api/${entry.name}`);
    continue;
  }

  // No nested API directories are used by this Vite project. Remove stale ones
  // left behind by previous browser/GitHub uploads so they cannot affect routing.
  if (entry.isDirectory()) {
    fs.rmSync(fullPath, { recursive: true, force: true });
    removed += 1;
    console.log(`[vercel-prebuild] Removed stale nested API directory: api/${entry.name}`);
  }
}

const remaining = fs.readdirSync(apiDir)
  .filter((name) => /\.(?:js|mjs|cjs|ts)$/.test(name) && !name.startsWith("."))
  .sort();

const missing = [...allowedApiFiles].filter((name) => !remaining.includes(name));
if (missing.length) {
  throw new Error(`[vercel-prebuild] Required API file(s) missing: ${missing.join(", ")}`);
}

if (remaining.length !== allowedApiFiles.size) {
  throw new Error(`[vercel-prebuild] Expected exactly ${allowedApiFiles.size} API functions, found ${remaining.length}: ${remaining.join(", ")}`);
}

console.log(`[vercel-prebuild] Removed ${removed} stale API item(s).`);
console.log(`[vercel-prebuild] Production API functions (${remaining.length}): ${remaining.join(", ")}`);
