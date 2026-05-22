import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const manifestPath = join(root, "manifest.json");
const manifest = readJson(manifestPath);
const errors = [];
const warnings = [];

check(manifest.manifest_version === 3, "manifest_version must be 3.");
check(Boolean(manifest.name), "manifest.name is required.");
check(Boolean(manifest.version), "manifest.version is required.");
check(Boolean(manifest.description), "manifest.description is required.");

collectManifestFiles(manifest).forEach((file) => {
  check(existsSync(join(root, file)), `Manifest references missing file: ${file}`);
});

for (const [size, file] of Object.entries(manifest.icons || {})) {
  check(["16", "32", "48", "128"].includes(size), `Unexpected icon size: ${size}`);
  check(existsSync(join(root, file)), `Missing icon file: ${file}`);
}

for (const file of listFiles(root)) {
  if ([".js", ".mjs"].includes(extname(file))) {
    checkJavaScript(file);
  }

  if (isTextFile(file)) {
    checkNoCommittedSecrets(file);
  }
}

if ((manifest.host_permissions || []).some((permission) => permission === "<all_urls>")) {
  warnings.push("Prefer explicit http/https host permissions over <all_urls>.");
}

if (errors.length) {
  console.error("Extension validation failed:");
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

if (warnings.length) {
  console.warn("Extension validation warnings:");
  warnings.forEach((warning) => console.warn(`- ${warning}`));
}

console.log(`Validated ${manifest.name} ${manifest.version}.`);

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    errors.push(`Cannot read JSON ${file}: ${error.message}`);
    return {};
  }
}

function collectManifestFiles(config) {
  const files = new Set(["manifest.json"]);

  if (config.background?.service_worker) files.add(config.background.service_worker);
  if (config.options_page) files.add(config.options_page);
  if (config.action?.default_popup) files.add(config.action.default_popup);

  Object.values(config.icons || {}).forEach((file) => files.add(file));
  Object.values(config.action?.default_icon || {}).forEach((file) => files.add(file));

  for (const script of config.content_scripts || []) {
    (script.js || []).forEach((file) => files.add(file));
    (script.css || []).forEach((file) => files.add(file));
  }

  return files;
}

function checkJavaScript(file) {
  const result = spawnSync(process.execPath, ["--check", file], {
    cwd: root,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    errors.push(`JavaScript syntax check failed for ${file}: ${result.stderr.trim() || result.stdout.trim()}`);
  }
}

function checkNoCommittedSecrets(file) {
  const text = readFileSync(join(root, file), "utf8");
  const secretPatterns = [
    /\bsk-[A-Za-z0-9_-]{20,}\b/,
    /\bAIza[0-9A-Za-z_-]{20,}\b/,
    /\bghp_[0-9A-Za-z]{20,}\b/,
  ];

  for (const pattern of secretPatterns) {
    if (pattern.test(text)) {
      errors.push(`Potential secret found in ${file}`);
      return;
    }
  }
}

function listFiles(dir, prefix = "") {
  const ignored = new Set([".git", "node_modules", "dist"]);
  const files = [];

  for (const entry of readdirSync(dir)) {
    if (ignored.has(entry)) continue;

    const absolute = join(dir, entry);
    const relative = prefix ? `${prefix}/${entry}` : entry;
    const stat = statSync(absolute);

    if (stat.isDirectory()) {
      files.push(...listFiles(absolute, relative));
    } else {
      files.push(relative);
    }
  }

  return files;
}

function isTextFile(file) {
  return [".css", ".html", ".js", ".json", ".md", ".mjs", ".txt", ".yml", ".yaml"].includes(extname(file));
}

function check(condition, message) {
  if (!condition) errors.push(message);
}
