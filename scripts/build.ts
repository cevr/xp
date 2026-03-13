// @effect-diagnostics effect/nodeBuiltinImport:off
import { mkdirSync, readFileSync, lstatSync, unlinkSync, symlinkSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import * as os from "node:os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf-8")) as {
  version: string;
};

console.log("Building xp...");

const binDir = join(rootDir, "bin");
mkdirSync(binDir, { recursive: true });

const platform =
  process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "windows" : "linux";
const arch = process.arch === "arm64" ? "arm64" : "x64";

const buildResult = await Bun.build({
  entrypoints: [join(rootDir, "src/main.ts")],
  target: "bun",
  minify: false,
  define: {
    __VERSION__: JSON.stringify(pkg.version),
  },
  compile: {
    target: `bun-${platform}-${arch}`,
    outfile: join(binDir, "xp"),
    autoloadBunfig: false,
  },
});

if (!buildResult.success) {
  console.error("Build failed:");
  for (const log of buildResult.logs) {
    console.error(log);
  }
  process.exit(1);
}

console.log(`Binary built: ${join(binDir, "xp")}`);

const home = process.env["HOME"] ?? os.homedir();
const bunBin = join(home, ".bun", "bin", "xp");
try {
  try {
    lstatSync(bunBin);
    unlinkSync(bunBin);
  } catch {
    // doesn't exist
  }
  symlinkSync(join(binDir, "xp"), bunBin);
  console.log(`Symlinked to: ${bunBin}`);
} catch (e) {
  console.log(`Could not symlink to ${bunBin}: ${e}`);
}
