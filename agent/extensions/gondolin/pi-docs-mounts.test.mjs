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
  /const PI_SUPERPOWERS_SKILLS_ROOT = path\.resolve\(EXTENSION_ROOT, "\.\.\/\.\.\/\.\.", "pi-base\/skills\/superpowers\/skills"\);/,
  "defines the shared superpowers skills root relative to the installed pi config root",
);

assert.match(
  source,
  /import \{ fileURLToPath \} from "node:url";/,
  "can derive the extension root independently of the session working directory",
);

assert.match(
  source,
  /import \{ RealFSProvider, ReadonlyProvider, VM \} from "@earendil-works\/gondolin";/,
  "imports ReadonlyProvider for read-only docs/examples/skills mounts",
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

assert.match(
  source,
  /\[PI_SUPERPOWERS_SKILLS_ROOT\]: new ReadonlyProvider\(new RealFSProvider\(PI_SUPERPOWERS_SKILLS_ROOT\)\)/,
  "mounts the superpowers skills directory through a read-only RealFSProvider",
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

assert.match(
  source,
  /command -v git >\/dev\/null 2>&1 \|\| apk add --no-cache git \|\| apk --no-check-certificate add --no-cache git/,
  "ensures git is available inside the Gondolin VM",
);
assert.match(source, /git config --system --add safe\.directory \$\{GUEST_WORKSPACE\}/, "marks the mounted workspace safe for git");

console.log("ok - safer pi coding agent docs/examples mounts are configured");
