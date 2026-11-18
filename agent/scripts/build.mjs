// Bundles the agent's TypeScript into two plain JavaScript files (no node_modules needed)
import { build } from "esbuild";

const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  logLevel: "info",
  // Lets any bundled code that still uses require() keep working inside an ES module
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
};

await build({ ...common, entryPoints: ["src/index.ts"], outfile: "dist/agent.mjs" }); // the agent itself
await build({ ...common, entryPoints: ["src/cli.ts"], outfile: "dist/cli.mjs" }); // pair / status / unpair

console.log("Built dist/agent.mjs and dist/cli.mjs");