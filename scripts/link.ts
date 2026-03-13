// @effect-diagnostics effect/nodeBuiltinImport:off
import { execSync } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

console.log("Linking xp globally...");
execSync("bun link", { cwd: rootDir, stdio: "inherit" });
console.log("Done. `xp` is now available globally.");
