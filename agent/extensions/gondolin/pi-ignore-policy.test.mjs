import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createFilteredFSProvider, createPiIgnorePolicy } from "./pi-ignore-policy.js";

async function test(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

async function withTempProject(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pi-ignore-policy-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

await test("policy denies files matched by root and nested .pi-ignore files", async () => {
  await withTempProject(async (root) => {
    await mkdir(path.join(root, "src", "secret"), { recursive: true });
    await writeFile(path.join(root, ".pi-ignore"), ".env\nsecret/**\n!secret/allowed.txt\n");
    await writeFile(path.join(root, "src", ".pi-ignore"), "local.txt\n");

    const policy = await createPiIgnorePolicy(root);

    assert.equal(policy.isIgnored(path.join(root, ".env")), true);
    assert.equal(policy.isIgnored(path.join(root, "secret", "hidden.txt")), true);
    assert.equal(policy.isIgnored(path.join(root, "secret", "allowed.txt")), false);
    assert.equal(policy.isIgnored(path.join(root, "src", "local.txt")), true);
    assert.equal(policy.isIgnored(path.join(root, "src", "index.ts")), false);
  });
});

await test("filtered provider blocks reads and hides ignored directory entries", async () => {
  await withTempProject(async (root) => {
    await writeFile(path.join(root, ".pi-ignore"), ".env\n");
    await writeFile(path.join(root, ".env"), "SECRET=1");
    await writeFile(path.join(root, "visible.txt"), "hello");

    const policy = await createPiIgnorePolicy(root);
    const provider = createFilteredFSProvider({
      async readFile(filePath, options) {
        return readFile(filePath, options);
      },
      async listDir(dirPath) {
        return [".env", "visible.txt"];
      },
      async stat(filePath) {
        return { isDirectory: () => false };
      },
      async access() {},
    }, root, policy);

    await assert.rejects(() => provider.readFile(path.join(root, ".env"), "utf8"), /Access denied by \.pi-ignore/);
    assert.deepEqual(await provider.listDir(root), ["visible.txt"]);
    assert.equal(await provider.readFile(path.join(root, "visible.txt"), "utf8"), "hello");
  });
});

await test("filtered provider blocks reads through allowed symlinks to ignored files", async () => {
  await withTempProject(async (root) => {
    await writeFile(path.join(root, ".pi-ignore"), ".env\n");
    await writeFile(path.join(root, ".env"), "SECRET=1");
    await symlink(".env", path.join(root, "public-link"));

    const policy = await createPiIgnorePolicy(root);
    const provider = createFilteredFSProvider({
      async readFile(filePath, options) {
        return readFile(filePath, options);
      },
    }, root, policy);

    await assert.rejects(
      () => provider.readFile(path.join(root, "public-link"), "utf8"),
      /Access denied by \.pi-ignore/,
    );
  });
});

await test("filtered provider blocks writes through dangling allowed symlinks to ignored files", async () => {
  await withTempProject(async (root) => {
    await writeFile(path.join(root, ".pi-ignore"), ".env\n");
    await symlink(".env", path.join(root, "public-link"));

    const policy = await createPiIgnorePolicy(root);
    const provider = createFilteredFSProvider({
      async writeFile(filePath, content) {
        return writeFile(filePath, content);
      },
    }, root, policy);

    await assert.rejects(
      () => provider.writeFile(path.join(root, "public-link"), "SECRET=1"),
      /Access denied by \.pi-ignore/,
    );
  });
});

await test("filtered provider hides symlinks that point to ignored files from directory listings", async () => {
  await withTempProject(async (root) => {
    await writeFile(path.join(root, ".pi-ignore"), ".env\n");
    await writeFile(path.join(root, ".env"), "SECRET=1");
    await writeFile(path.join(root, "visible.txt"), "hello");
    await symlink(".env", path.join(root, "public-link"));

    const policy = await createPiIgnorePolicy(root);
    const provider = createFilteredFSProvider({
      async listDir() {
        return [".env", "public-link", "visible.txt"];
      },
      readdirSync() {
        return [".env", "public-link", "visible.txt"];
      },
    }, root, policy);

    assert.deepEqual(await provider.listDir(root), ["visible.txt"]);
    assert.deepEqual(provider.readdirSync(root), ["visible.txt"]);
  });
});

await test("filtered provider blocks writes through symlinked parent directories to ignored paths", async () => {
  await withTempProject(async (root) => {
    await mkdir(path.join(root, "secret"));
    await writeFile(path.join(root, ".pi-ignore"), "secret/**\n");
    await symlink("secret", path.join(root, "public"));

    const policy = await createPiIgnorePolicy(root);
    const provider = createFilteredFSProvider({
      async writeFile(filePath, content) {
        return writeFile(filePath, content);
      },
    }, root, policy);

    await assert.rejects(
      () => provider.writeFile(path.join(root, "public", "new.txt"), "SECRET=1"),
      /Access denied by \.pi-ignore/,
    );
  });
});

await test("filtered provider denies symlinks to existing files and directories outside the project root", async () => {
  await withTempProject(async (root) => {
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "pi-ignore-outside-"));
    try {
      await writeFile(path.join(outsideRoot, "outside.txt"), "outside");
      await symlink(path.join(outsideRoot, "outside.txt"), path.join(root, "outside-file-link"));
      await symlink(outsideRoot, path.join(root, "outside-dir-link"));

      const policy = await createPiIgnorePolicy(root);
      const provider = createFilteredFSProvider({
        async readFile(filePath, options) {
          return readFile(filePath, options);
        },
        async writeFile(filePath, content) {
          return writeFile(filePath, content);
        },
      }, root, policy);

      await assert.rejects(
        () => provider.readFile(path.join(root, "outside-file-link"), "utf8"),
        /Access denied by \.pi-ignore/,
      );
      await assert.rejects(
        () => provider.writeFile(path.join(root, "outside-dir-link", "new.txt"), "outside write"),
        /Access denied by \.pi-ignore/,
      );
    } finally {
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });
});

await test("filtered provider blocks dangling symlink targets whose parents escape the project root", async () => {
  await withTempProject(async (root) => {
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "pi-ignore-outside-"));
    try {
      await symlink(outsideRoot, path.join(root, "public"));
      await symlink(path.join("public", "new.txt"), path.join(root, "link"));

      const policy = await createPiIgnorePolicy(root);
      const provider = createFilteredFSProvider({
        async writeFile(filePath, content) {
          return writeFile(filePath, content);
        },
      }, root, policy);

      await assert.rejects(
        () => provider.writeFile(path.join(root, "link"), "outside write"),
        /Access denied by \.pi-ignore/,
      );
    } finally {
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });
});

await test("filtered provider blocks mutation destinations through symlinked parent directories", async () => {
  await withTempProject(async (root) => {
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "pi-ignore-outside-"));
    try {
      await writeFile(path.join(root, "visible.txt"), "hello");
      await symlink(outsideRoot, path.join(root, "outside-dir-link"));
      const calls = [];
      const policy = await createPiIgnorePolicy(root);
      const provider = createFilteredFSProvider({
        async symlink(targetPath, linkPath) { calls.push(["symlink", targetPath, linkPath]); },
        symlinkSync(targetPath, linkPath) { calls.push(["symlinkSync", targetPath, linkPath]); },
        async rename(fromPath, toPath) { calls.push(["rename", fromPath, toPath]); },
        renameSync(fromPath, toPath) { calls.push(["renameSync", fromPath, toPath]); },
        async link(fromPath, toPath) { calls.push(["link", fromPath, toPath]); },
        linkSync(fromPath, toPath) { calls.push(["linkSync", fromPath, toPath]); },
      }, root, policy);

      await assert.rejects(
        () => provider.symlink(path.join(root, "visible.txt"), path.join(root, "outside-dir-link", "created")),
        /Access denied by \.pi-ignore/,
      );
      assert.throws(
        () => provider.symlinkSync(path.join(root, "visible.txt"), path.join(root, "outside-dir-link", "created")),
        /Access denied by \.pi-ignore/,
      );
      await assert.rejects(
        () => provider.rename(path.join(root, "visible.txt"), path.join(root, "outside-dir-link", "moved")),
        /Access denied by \.pi-ignore/,
      );
      assert.throws(
        () => provider.renameSync(path.join(root, "visible.txt"), path.join(root, "outside-dir-link", "moved")),
        /Access denied by \.pi-ignore/,
      );
      await assert.rejects(
        () => provider.link(path.join(root, "visible.txt"), path.join(root, "outside-dir-link", "hardlink")),
        /Access denied by \.pi-ignore/,
      );
      assert.throws(
        () => provider.linkSync(path.join(root, "visible.txt"), path.join(root, "outside-dir-link", "hardlink")),
        /Access denied by \.pi-ignore/,
      );
      assert.deepEqual(calls, []);
    } finally {
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });
});

await test("filtered provider blocks copyFile through symlinks to ignored files", async () => {
  await withTempProject(async (root) => {
    await writeFile(path.join(root, ".pi-ignore"), ".env\n");
    await writeFile(path.join(root, ".env"), "SECRET=1");
    await writeFile(path.join(root, "visible.txt"), "hello");
    await symlink(".env", path.join(root, "public-link"));

    const policy = await createPiIgnorePolicy(root);
    const calls = [];
    const provider = createFilteredFSProvider({
      async copyFile(fromPath, toPath) {
        calls.push([fromPath, toPath]);
      },
      copyFileSync(fromPath, toPath) {
        calls.push([fromPath, toPath]);
      },
    }, root, policy);

    await assert.rejects(
      () => provider.copyFile(path.join(root, "public-link"), path.join(root, "leaked.txt")),
      /Access denied by \.pi-ignore/,
    );
    await assert.rejects(
      () => provider.copyFile(path.join(root, "visible.txt"), path.join(root, "public-link")),
      /Access denied by \.pi-ignore/,
    );
    assert.throws(
      () => provider.copyFileSync(path.join(root, "public-link"), path.join(root, "leaked.txt")),
      /Access denied by \.pi-ignore/,
    );
    assert.throws(
      () => provider.copyFileSync(path.join(root, "visible.txt"), path.join(root, "public-link")),
      /Access denied by \.pi-ignore/,
    );
    assert.deepEqual(calls, []);
  });
});

await test("filtered provider supports provider-relative absolute paths when mounted behind Gondolin", async () => {
  await withTempProject(async (root) => {
    await writeFile(path.join(root, ".pi-ignore"), "secret.txt\n");
    await writeFile(path.join(root, "visible.txt"), "hello");
    await writeFile(path.join(root, "secret.txt"), "secret");
    const policy = await createPiIgnorePolicy(root);
    const provider = createFilteredFSProvider({
      async readFile(filePath) { return `read:${filePath}`; },
      async writeFile(filePath) { return `write:${filePath}`; },
    }, root, policy, { mountPoint: "/workspace", providerRelativeAbsolute: true });

    assert.equal(await provider.readFile("/visible.txt"), "read:/visible.txt");
    await assert.rejects(() => provider.readFile("/secret.txt"), /Access denied by \.pi-ignore/);
    await assert.rejects(() => provider.writeFile("/secret.txt", "x"), /Access denied by \.pi-ignore/);
  });
});

await test("filtered provider denies absolute paths outside the workspace before delegating", async () => {
  await withTempProject(async (root) => {
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "pi-ignore-outside-"));
    try {
      const outsidePath = path.join(outsideRoot, "outside.txt");
      await writeFile(outsidePath, "outside");
      const policy = await createPiIgnorePolicy(root);
      const calls = [];
      const provider = createFilteredFSProvider({
        async readFile(filePath) { calls.push(["readFile", filePath]); return "outside"; },
        async writeFile(filePath) { calls.push(["writeFile", filePath]); },
        async copyFile(fromPath, toPath) { calls.push(["copyFile", fromPath, toPath]); },
        async rename(fromPath, toPath) { calls.push(["rename", fromPath, toPath]); },
        async link(fromPath, toPath) { calls.push(["link", fromPath, toPath]); },
        async symlink(targetPath, linkPath) { calls.push(["symlink", targetPath, linkPath]); },
      }, root, policy);

      await assert.rejects(() => provider.readFile(outsidePath), /Access denied by \.pi-ignore/);
      await assert.rejects(() => provider.writeFile(outsidePath, "x"), /Access denied by \.pi-ignore/);
      await assert.rejects(() => provider.copyFile(outsidePath, path.join(root, "copy")), /Access denied by \.pi-ignore/);
      await assert.rejects(() => provider.rename(path.join(root, "missing"), outsidePath), /Access denied by \.pi-ignore/);
      await assert.rejects(() => provider.link(path.join(root, "missing"), outsidePath), /Access denied by \.pi-ignore/);
      await assert.rejects(() => provider.symlink(outsidePath, path.join(root, "safe-link")), /Access denied by \.pi-ignore/);
      assert.deepEqual(calls, []);
    } finally {
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });
});

await test("filtered provider hides exists results through symlinks to ignored or outside-root files", async () => {
  await withTempProject(async (root) => {
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "pi-ignore-outside-"));
    try {
      await writeFile(path.join(root, ".pi-ignore"), ".env\n");
      await writeFile(path.join(root, ".env"), "SECRET=1");
      await writeFile(path.join(outsideRoot, "outside.txt"), "outside");
      await symlink(".env", path.join(root, "env-link"));
      await symlink(path.join(outsideRoot, "outside.txt"), path.join(root, "outside-link"));
      await writeFile(path.join(root, "visible.txt"), "hello");
      const policy = await createPiIgnorePolicy(root);
      const provider = createFilteredFSProvider({
        async exists() { return true; },
        existsSync() { return true; },
      }, root, policy);

      assert.equal(await provider.exists(path.join(root, "env-link")), false);
      assert.equal(provider.existsSync(path.join(root, "env-link")), false);
      assert.equal(await provider.exists(path.join(root, "outside-link")), false);
      assert.equal(provider.existsSync(path.join(root, "outside-link")), false);
      assert.equal(await provider.exists(path.join(root, "visible.txt")), true);
      assert.equal(provider.existsSync(path.join(root, "visible.txt")), true);
    } finally {
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });
});

await test("filtered provider blocks symlink creation at ignored destinations", async () => {
  await withTempProject(async (root) => {
    await writeFile(path.join(root, ".pi-ignore"), "blocked-link\n.env\n");
    const policy = await createPiIgnorePolicy(root);
    const calls = [];
    const provider = createFilteredFSProvider({
      async symlink(targetPath, linkPath) {
        calls.push([targetPath, linkPath]);
      },
      symlinkSync(targetPath, linkPath) {
        calls.push([targetPath, linkPath]);
      },
    }, root, policy);

    await assert.rejects(
      () => provider.symlink("visible.txt", path.join(root, "blocked-link")),
      /Access denied by \.pi-ignore/,
    );
    assert.throws(
      () => provider.symlinkSync("visible.txt", path.join(root, "blocked-link")),
      /Access denied by \.pi-ignore/,
    );
    await assert.rejects(
      () => provider.symlink(".env", path.join(root, "allowed-link")),
      /Access denied by \.pi-ignore/,
    );
    assert.throws(
      () => provider.symlinkSync(".env", path.join(root, "allowed-link")),
      /Access denied by \.pi-ignore/,
    );
    assert.deepEqual(calls, []);
  });
});

if (process.exitCode) process.exit(process.exitCode);
