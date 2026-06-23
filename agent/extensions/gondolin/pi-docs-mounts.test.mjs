import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");

assert.match(
  source,
  /const PI_CODING_AGENT_ROOT =\s*"\/opt\/homebrew\/lib\/node_modules\/@earendil-works\/pi-coding-agent";/,
  "defines the pi coding agent package root mount point",
);

assert.match(
  source,
  /const PI_CODING_AGENT_README = path\.join\(PI_CODING_AGENT_ROOT, "README\.md"\);/,
  "defines the pi coding agent README path",
);

assert.match(
  source,
  /const PI_CODING_AGENT_DOCS_ROOT = path\.join\(PI_CODING_AGENT_ROOT, "docs"\);/,
  "defines the pi coding agent docs root",
);

assert.match(
  source,
  /const PI_CODING_AGENT_EXAMPLES_ROOT = path\.join\(PI_CODING_AGENT_ROOT, "examples"\);/,
  "defines the pi coding agent examples root",
);

assert.match(
  source,
  /const AGENT_SKILLS_ROOT = path\.resolve\(EXTENSION_ROOT, "\.\.\/\.\.", "skills"\);/,
  "defines the active agent skills root relative to the extension root",
);

assert.match(
  source,
  /const PI_SUPERPOWERS_SKILLS_ROOT = path\.resolve\(EXTENSION_ROOT, "\.\.\/\.\.\/\.\.", "pi-base\/skills\/superpowers\/skills"\);/,
  "defines the shared superpowers skills root relative to the installed pi config root",
);

assert.match(
  source,
  /const PI_WIKI_ROOT = path\.resolve\(EXTENSION_ROOT, "\.\.\/\.\.\/\.\.", "wiki"\);/,
  "defines the global wiki root relative to the installed pi config root",
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
  /function createPiCodingAgentDocsProvider\(\)/,
  "defines a dedicated pi docs provider",
);

assert.match(
  source,
  /resolved === PI_CODING_AGENT_README/,
  "allowlists the pi coding agent README",
);

assert.match(
  source,
  /allowedRoots\.some\(\(root\) => isInsideHostPath\(root, resolved\)\)/,
  "allowlists only the docs and examples trees under the package root",
);

assert.match(
  source,
  /\[PI_CODING_AGENT_ROOT\]: new ReadonlyProvider\(createPiCodingAgentDocsProvider\(\)\)/,
  "mounts the package docs allowlist through a read-only provider",
);

assert.match(
  source,
  /\[AGENT_SKILLS_ROOT\]: new ReadonlyProvider\(new RealFSProvider\(AGENT_SKILLS_ROOT\)\)/,
  "mounts the active agent skills directory through a read-only RealFSProvider",
);

assert.match(
  source,
  /\[PI_SUPERPOWERS_SKILLS_ROOT\]: new ReadonlyProvider\(new RealFSProvider\(PI_SUPERPOWERS_SKILLS_ROOT\)\)/,
  "mounts the superpowers skills directory through a read-only RealFSProvider",
);

assert.match(
  source,
  /mkdirSync\(PI_WIKI_ROOT, \{ recursive: true \}\)/,
  "ensures the global wiki directory exists before mounting",
);

assert.match(
  source,
  /\[PI_WIKI_ROOT\]: new ReadonlyProvider\(new RealFSProvider\(PI_WIKI_ROOT\)\)/,
  "mounts the global wiki directory read-only so writes go through confirmed wiki tools",
);

assert.doesNotMatch(
  source,
  /\[PI_CODING_AGENT_ROOT\]: new ReadonlyProvider\(new RealFSProvider\(PI_CODING_AGENT_ROOT\)\)/,
  "does not expose the whole pi coding agent package root directly through RealFSProvider",
);

assert.doesNotMatch(
  source,
  /new RealFSProvider\(\s*["'`]\/opt\/homebrew\/lib\/node_modules\/@earendil-works\/pi-coding-agent["'`]\s*\)/,
  "does not expose the whole pi coding agent package root through an unfiltered literal RealFSProvider",
);

assert.match(
  source,
  /command -v git >\/dev\/null 2>&1 \|\| apk add --no-cache git \|\| apk --no-check-certificate add --no-cache git/,
  "ensures git is available inside the Gondolin VM",
);
assert.match(source, /git config --system --add safe\.directory \$\{GUEST_WORKSPACE\}/, "marks the mounted workspace safe for git");

console.log("ok - safer pi coding agent docs/examples mounts are configured");
