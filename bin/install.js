#!/usr/bin/env node
// Vendors the community-moderation plugin (skill + agents + commands) into a
// project's ./.claude/ so Claude Code discovers it. Node core only — no deps.
// On demand via `npx community-moderation-skill`. For an all-projects install,
// use the Claude Code plugin marketplace instead (see README → Install).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");
// Plugin components copied verbatim. The skill is self-contained under skills/.
const COMPONENTS = ["skills", "agents", "commands"];
const SKIP = new Set([".DS_Store", "node_modules", "__pycache__", ".pytest_cache"]);

function copyRecursive(src, dst) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      if (SKIP.has(name) || name.endsWith(".pyc")) continue;
      copyRecursive(path.join(src, name), path.join(dst, name));
    }
  } else {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
}

// Target: explicit arg, else project-local ./.claude, else ~/.claude.
const arg = process.argv[2];
const home = process.env.HOME || process.env.USERPROFILE || ".";
const dest = arg
  ? path.resolve(arg)
  : fs.existsSync(path.join(process.cwd(), ".claude"))
  ? path.join(process.cwd(), ".claude")
  : path.join(home, ".claude");

let copied = 0;
for (const comp of COMPONENTS) {
  const src = path.join(PKG_ROOT, comp);
  if (!fs.existsSync(src)) continue;
  copyRecursive(src, path.join(dest, comp));
  copied++;
}

if (!copied) {
  console.error("community-moderation-skill: no components found to install.");
  process.exit(1);
}
console.log(`community-moderation-skill installed -> ${dest}`);
console.log("Try: \"using community-moderation, moderate this message: 'validate your wallet here'\"");
