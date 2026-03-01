import { existsSync, mkdirSync, readdirSync, rmSync } from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const vendorDir = path.join(repoRoot, "vendor");
const manualDir = path.join(vendorDir, "Grossing-Manual");
const gitRemote = "https://github.com/jbaron9393/Grossing-Manual.git";

function runGit(args, cwd = repoRoot) {
  execFileSync("git", args, { cwd, stdio: "inherit" });
}

function syncGrossingManual() {
  mkdirSync(vendorDir, { recursive: true });

  const hasGitRepo = existsSync(path.join(manualDir, ".git"));

  if (!hasGitRepo) {
    if (existsSync(manualDir) && readdirSync(manualDir).length > 0) {
      rmSync(manualDir, { recursive: true, force: true });
    }

    runGit(["clone", "--depth", "1", gitRemote, manualDir]);
    return;
  }

  runGit(["-C", manualDir, "fetch", "origin", "main", "--depth", "1"]);
  runGit(["-C", manualDir, "reset", "--hard", "origin/main"]);
}

try {
  syncGrossingManual();
  console.log("Grossing Manual synced to vendor/Grossing-Manual");
} catch (err) {
  console.error("Failed to sync Grossing Manual:", err?.message || err);
  process.exit(1);
}
