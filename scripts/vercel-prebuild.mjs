import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const rootApi = path.resolve(root, "api");
const isVercel = process.env.VERCEL === "1" || process.env.VERCEL === "true" || process.env.FORCE_VERCEL_CLEANUP === "1";

if (!isVercel) {
  console.log("[vercel-prebuild] Local build: cleanup not required.");
  process.exit(0);
}

const obsoleteRootFunctions = [
  "payment-declarations.js",
  "newsletter-signup.js",
  "send-friend-request.js",
  "verify-manage-code.js",
  "approve-event.js",
  "move-event.js",
];

let removed = 0;
for (const file of obsoleteRootFunctions) {
  const target = path.join(rootApi, file);
  if (fs.existsSync(target)) {
    fs.rmSync(target, { force: true });
    removed += 1;
    console.log(`[vercel-prebuild] Removed obsolete root function: api/${file}`);
  }
}

const skipDirs = new Set(["node_modules", ".git", ".vercel", "dist"]);
function removeNestedApiDirs(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (skipDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.name === "api" && path.resolve(full) !== rootApi) {
      fs.rmSync(full, { recursive: true, force: true });
      removed += 1;
      console.log(`[vercel-prebuild] Removed nested duplicate API directory: ${path.relative(root, full)}`);
      continue;
    }
    removeNestedApiDirs(full);
  }
}
removeNestedApiDirs(root);

const functions = fs.existsSync(rootApi)
  ? fs.readdirSync(rootApi).filter((name) => /\.(?:js|mjs|cjs|ts)$/.test(name) && !name.startsWith("_") && !name.startsWith(".")).sort()
  : [];

console.log(`[vercel-prebuild] Cleanup complete. Removed ${removed} obsolete/duplicate item(s).`);
console.log(`[vercel-prebuild] Root Vercel Functions (${functions.length}): ${functions.join(", ")}`);
if (functions.length > 10) {
  throw new Error(`Hobby safety check failed: expected at most 10 root Vercel Functions, found ${functions.length}.`);
}
