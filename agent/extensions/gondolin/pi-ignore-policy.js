import fs from "node:fs";
import path from "node:path";
import ignore from "ignore";

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeRoot(root) {
  return path.resolve(root);
}

function realpathIfExists(value) {
  try {
    return fs.realpathSync(value);
  } catch {
    return null;
  }
}

function normalizeRelative(value) {
  return value.split(path.sep).join("/");
}

function dirsFromRootToTarget(root, target) {
  const targetDir = fs.existsSync(target) && fs.statSync(target).isDirectory() ? target : path.dirname(target);
  const relativeDir = path.relative(root, targetDir);
  const parts = relativeDir && relativeDir !== "." ? relativeDir.split(path.sep).filter(Boolean) : [];
  const dirs = [root];
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    dirs.push(current);
  }
  return dirs;
}

function loadIgnoreFiles(root, target) {
  const files = [];
  for (const dir of dirsFromRootToTarget(root, target)) {
    const file = path.join(dir, ".pi-ignore");
    if (!fs.existsSync(file)) continue;
    try {
      files.push({ dir, matcher: ignore().add(fs.readFileSync(file, "utf8")) });
    } catch {
      // Ignore unreadable/malformed policy files rather than breaking the VM startup.
    }
  }
  return files;
}

export async function createPiIgnorePolicy(root) {
  return createPiIgnorePolicySync(root);
}

export function createPiIgnorePolicySync(root) {
  const policyRoot = normalizeRoot(root);
  const canonicalPolicyRoot = realpathIfExists(policyRoot) ?? policyRoot;
  return {
    root: policyRoot,
    canonicalRoot: canonicalPolicyRoot,
    isInsideRoot(candidate) {
      const target = path.resolve(candidate);
      if (isInside(policyRoot, target)) return true;
      const canonicalTarget = realpathIfExists(target) ?? target;
      return isInside(canonicalPolicyRoot, canonicalTarget);
    },
    isIgnored(candidate) {
      let target = path.resolve(candidate);
      if (!isInside(policyRoot, target)) {
        const canonicalTarget = realpathIfExists(target) ?? target;
        if (!isInside(canonicalPolicyRoot, canonicalTarget)) return false;
        target = path.join(policyRoot, path.relative(canonicalPolicyRoot, canonicalTarget));
      }

      let ignored = false;
      for (const { dir, matcher } of loadIgnoreFiles(policyRoot, target)) {
        const relative = normalizeRelative(path.relative(dir, target));
        if (!relative || relative.startsWith("..")) continue;
        if (matcher.ignores(relative)) ignored = true;
        if (matcher.test(relative).unignored) ignored = false;
      }
      return ignored;
    },
    assertAllowed(candidate) {
      if (this.isIgnored(candidate)) {
        throw new Error(`Access denied by .pi-ignore: ${candidate}`);
      }
    },
  };
}

function toHostPath(hostRoot, mountPoint, inputPath, options = {}) {
  const value = String(inputPath || ".");
  const posixValue = value.split(path.sep).join(path.posix.sep);

  if (path.isAbsolute(value)) {
    const resolved = path.resolve(value);
    if (isInside(hostRoot, resolved)) return resolved;

    if (mountPoint && (posixValue === mountPoint || posixValue.startsWith(`${mountPoint}/`))) {
      return posixValue === mountPoint
        ? hostRoot
        : path.join(hostRoot, ...posixValue.slice(mountPoint.length + 1).split("/"));
    }

    if (options.providerRelativeAbsolute) {
      return path.join(hostRoot, ...posixValue.split("/").filter(Boolean));
    }

    throw new Error(`Access denied by .pi-ignore: ${inputPath}`);
  }

  return path.join(hostRoot, ...posixValue.split("/").filter(Boolean));
}

function entryName(entry) {
  return typeof entry === "string" ? entry : entry.name;
}

function deniedError(policy, hostRoot, mountPoint, inputPath, pathOptions = {}) {
  const hostPath = toHostPath(hostRoot, mountPoint, inputPath, pathOptions);
  policy.assertAllowed(hostPath);
  return hostPath;
}

function canonicalizeExistingAncestor(hostPath) {
  const missing = [];
  let current = path.resolve(hostPath);
  while (!fs.existsSync(current)) {
    missing.unshift(path.basename(current));
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.join(fs.realpathSync(current), ...missing);
}

function assertInsideRoot(policy, hostPath) {
  if (!policy.isInsideRoot(hostPath)) throw new Error(`Access denied by .pi-ignore: ${hostPath}`);
}

function assertCanonicalAllowed(policy, hostPath) {
  const canonicalPath = realpathIfExists(hostPath) ?? canonicalizeExistingAncestor(hostPath);
  assertInsideRoot(policy, canonicalPath);
  policy.assertAllowed(canonicalPath);
}

async function assertAllowedAndResolved(policy, hostPath) {
  policy.assertAllowed(hostPath);
  assertCanonicalAllowed(policy, hostPath);
  try {
    const stat = await fs.promises.lstat(hostPath);
    if (stat.isSymbolicLink()) {
      const linkTarget = await fs.promises.readlink(hostPath);
      assertCanonicalAllowed(policy, path.resolve(path.dirname(hostPath), linkTarget));
    }
  } catch (linkError) {
    if (linkError?.code !== "ENOENT") throw linkError;
  }
}

function assertAllowedAndResolvedSync(policy, hostPath) {
  policy.assertAllowed(hostPath);
  assertCanonicalAllowed(policy, hostPath);
  try {
    const stat = fs.lstatSync(hostPath);
    if (stat.isSymbolicLink()) {
      const linkTarget = fs.readlinkSync(hostPath);
      assertCanonicalAllowed(policy, path.resolve(path.dirname(hostPath), linkTarget));
    }
  } catch (linkError) {
    if (linkError?.code !== "ENOENT") throw linkError;
  }
}

async function isAllowedAndResolved(policy, hostPath) {
  try {
    await assertAllowedAndResolved(policy, hostPath);
    return true;
  } catch {
    return false;
  }
}

function isAllowedAndResolvedSync(policy, hostPath) {
  try {
    assertAllowedAndResolvedSync(policy, hostPath);
    return true;
  } catch {
    return false;
  }
}

function resolveSymlinkTargetHostPath(hostRoot, mountPoint, targetPath, linkHostPath, pathOptions = {}) {
  const rawTarget = String(targetPath || "");
  if (path.isAbsolute(rawTarget)) return toHostPath(hostRoot, mountPoint, rawTarget, pathOptions);
  return path.resolve(path.dirname(linkHostPath), rawTarget);
}

export function createFilteredFSProvider(inner, hostRoot, policy, options = {}) {
  const root = normalizeRoot(hostRoot);
  const mountPoint = options.mountPoint;
  const pathOptions = { providerRelativeAbsolute: Boolean(options.providerRelativeAbsolute) };
  const hostPathFor = (inputPath) => toHostPath(root, mountPoint, inputPath, pathOptions);

  const guardedMethods = new Set([
    "open",
    "openSync",
    "stat",
    "statSync",
    "lstat",
    "lstatSync",
    "readFile",
    "readFileSync",
    "writeFile",
    "writeFileSync",
    "appendFile",
    "appendFileSync",
    "mkdir",
    "mkdirSync",
    "rmdir",
    "rmdirSync",
    "unlink",
    "unlinkSync",
    "access",
    "accessSync",
    "realpath",
    "realpathSync",
    "readlink",
    "readlinkSync",
    "statfs",
    "watch",
    "watchAsync",
    "watchFile",
  ]);

  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === "listDir" || prop === "readdir") {
        return async (dirPath, ...args) => {
          await assertAllowedAndResolved(policy, hostPathFor(dirPath));
          const entries = await target[prop](dirPath, ...args);
          const results = [];
          for (const entry of entries) {
            const childHostPath = path.join(hostPathFor(dirPath), entryName(entry));
            if (await isAllowedAndResolved(policy, childHostPath)) results.push(entry);
          }
          return results;
        };
      }

      if (prop === "readdirSync") {
        return (dirPath, ...args) => {
          assertAllowedAndResolvedSync(policy, hostPathFor(dirPath));
          const entries = target[prop](dirPath, ...args);
          return entries.filter((entry) => {
            const childHostPath = path.join(hostPathFor(dirPath), entryName(entry));
            return isAllowedAndResolvedSync(policy, childHostPath);
          });
        };
      }

      if (prop === "symlink") {
        return async (targetPath, linkPath, ...args) => {
          const linkHostPath = hostPathFor(linkPath);
          await assertAllowedAndResolved(policy, linkHostPath);
          await assertAllowedAndResolved(policy, resolveSymlinkTargetHostPath(root, mountPoint, targetPath, linkHostPath, pathOptions));
          return target[prop](targetPath, linkPath, ...args);
        };
      }

      if (prop === "symlinkSync") {
        return (targetPath, linkPath, ...args) => {
          const linkHostPath = hostPathFor(linkPath);
          assertAllowedAndResolvedSync(policy, linkHostPath);
          assertAllowedAndResolvedSync(policy, resolveSymlinkTargetHostPath(root, mountPoint, targetPath, linkHostPath, pathOptions));
          return target[prop](targetPath, linkPath, ...args);
        };
      }

      if (prop === "copyFile") {
        return async (fromPath, toPath, ...args) => {
          await assertAllowedAndResolved(policy, hostPathFor(fromPath));
          await assertAllowedAndResolved(policy, hostPathFor(toPath));
          return target[prop](fromPath, toPath, ...args);
        };
      }

      if (prop === "copyFileSync") {
        return (fromPath, toPath, ...args) => {
          assertAllowedAndResolvedSync(policy, hostPathFor(fromPath));
          assertAllowedAndResolvedSync(policy, hostPathFor(toPath));
          return target[prop](fromPath, toPath, ...args);
        };
      }

      if (prop === "rename" || prop === "link") {
        return async (fromPath, toPath, ...args) => {
          await assertAllowedAndResolved(policy, hostPathFor(fromPath));
          await assertAllowedAndResolved(policy, hostPathFor(toPath));
          return target[prop](fromPath, toPath, ...args);
        };
      }

      if (prop === "renameSync" || prop === "linkSync") {
        return (fromPath, toPath, ...args) => {
          assertAllowedAndResolvedSync(policy, hostPathFor(fromPath));
          assertAllowedAndResolvedSync(policy, hostPathFor(toPath));
          return target[prop](fromPath, toPath, ...args);
        };
      }

      if (prop === "exists") {
        return async (filePath, ...args) => {
          const hostPath = hostPathFor(filePath);
          if (!(await isAllowedAndResolved(policy, hostPath))) return false;
          return target[prop](filePath, ...args);
        };
      }

      if (prop === "existsSync") {
        return (filePath, ...args) => {
          const hostPath = hostPathFor(filePath);
          if (!isAllowedAndResolvedSync(policy, hostPath)) return false;
          return target[prop](filePath, ...args);
        };
      }

      if (guardedMethods.has(String(prop))) {
        if (String(prop).endsWith("Sync")) {
          return (filePath, ...args) => {
            assertAllowedAndResolvedSync(policy, hostPathFor(filePath));
            return target[prop](filePath, ...args);
          };
        }
        return async (filePath, ...args) => {
          await assertAllowedAndResolved(policy, hostPathFor(filePath));
          return target[prop](filePath, ...args);
        };
      }

      return Reflect.get(target, prop, receiver);
    },
  });
}
