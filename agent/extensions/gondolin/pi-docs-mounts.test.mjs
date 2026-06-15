import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");

assert.match(
  source,
  /const PI_CODING_AGENT_DOCS_ROOT =\s*"\/opt\/homebrew\/lib\/node_modules\/@earendil-works\/pi-coding-agent\/docs";/,
  "defines the pi coding agent docs root",
);

assert.match(
  source,
  /const PI_CODING_AGENT_EXAMPLES_ROOT =\s*"\/opt\/homebrew\/lib\/node_modules\/@earendil-works\/pi-coding-agent\/examples";/,
  "defines the pi coding agent examples root",
);

assert.match(
  source,
  /import \{ RealFSProvider, ReadonlyProvider, VM \} from "@earendil-works\/gondolin";/,
  "imports ReadonlyProvider for read-only docs/examples mounts",
);

assert.match(
  source,
  /\[PI_CODING_AGENT_DOCS_ROOT\]: new ReadonlyProvider\(new RealFSProvider\(PI_CODING_AGENT_DOCS_ROOT\)\)/,
  "mounts the docs directory through a read-only RealFSProvider",
);

assert.match(
  source,
  /\[PI_CODING_AGENT_EXAMPLES_ROOT\]: new ReadonlyProvider\(new RealFSProvider\(PI_CODING_AGENT_EXAMPLES_ROOT\)\)/,
  "mounts the examples directory through a read-only RealFSProvider",
);

assert.doesNotMatch(
  source,
  /PI_CODING_AGENT_ROOT[\s\S]*new RealFSProvider\(PI_CODING_AGENT_ROOT\)/,
  "does not mount the whole pi coding agent package root via a root constant",
);

assert.doesNotMatch(
  source,
  /["'`]\/opt\/homebrew\/lib\/node_modules\/@earendil-works\/pi-coding-agent["'`]\s*:/,
  "does not mount the pi coding agent package root as a mount point literal",
);

assert.doesNotMatch(
  source,
  /new RealFSProvider\(\s*["'`]\/opt\/homebrew\/lib\/node_modules\/@earendil-works\/pi-coding-agent["'`]\s*\)/,
  "does not expose the whole pi coding agent package root through RealFSProvider",
);

console.log("ok - safer pi coding agent docs/examples mounts are configured");
