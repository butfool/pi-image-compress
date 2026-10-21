import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
const installRoot = process.env.PI_MANAGED_INSTALL_ROOT ?? join(agentDir, "install");
const version = readFileSync(join(installRoot, "current-version"), "utf8").trim();
const releaseRoot = join(installRoot, "releases", version, "node_modules");

const links = [
  ["@earendil-works/pi-coding-agent", join(releaseRoot, "@earendil-works", "pi-coding-agent")],
  ["@earendil-works/pi-ai", join(releaseRoot, "@earendil-works", "pi-ai")],
  ["@types", join(releaseRoot, "@types")],
];

for (const [name, target] of links) {
  if (!existsSync(target)) {
    throw new Error(`Missing Pi installation package: ${target}`);
  }
  const link = join(projectRoot, "node_modules", name);
  rmSync(link, { recursive: true, force: true });
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(target, link, "dir");
}

console.log(`Linked type dependencies from ${releaseRoot}`);
