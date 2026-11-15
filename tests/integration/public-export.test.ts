// @vitest-environment node
import { execFileSync } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportPublic } from "../../scripts/export-public";

let directory: string;
let source: string;
let target: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "public-export-"));
  source = join(directory, "source"); target = join(directory, "export");
  await mkdir(source);
  execFileSync("git", ["init", "--quiet"], { cwd: source });
  await mkdir(join(source, "docs/archive"), { recursive: true });
  await writeFile(join(source, "README.md"), "# Preview\n[History](docs/archive/report.md)\n");
  await writeFile(join(source, "docs/archive/report.md"), "Private development history");
  await writeFile(join(source, ".env.example"), "AI_PROVIDER=mock\n");
  execFileSync("git", ["add", "."], { cwd: source });
  execFileSync("git", ["-c", "user.name=Export Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "fixture"], { cwd: source });
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("public export", () => {
  it("uses committed content and leaves secrets, private reports, and history behind", async () => {
    await writeFile(join(source, ".env.local"), "PRIVATE=untracked\n");
    await writeFile(join(source, "README.md"), "Uncommitted text");
    expect(await exportPublic(source, target)).toBe(2);
    expect(await readFile(join(target, "README.md"), "utf8")).toBe("# Preview\nHistory（開発履歴・配布対象外）\n");
    for (const path of [".env.local", ".git", "docs/archive/report.md"]) {
      await expect(readFile(join(target, path))).rejects.toThrow();
    }
    await expect(exportPublic(source, target)).rejects.toThrow();
  });

  it("rejects private information before creating any destination", async () => {
    await writeFile(join(source, "README.md"), "/home/private-owner/source\n");
    execFileSync("git", ["add", "README.md"], { cwd: source });
    execFileSync("git", ["-c", "user.name=Export Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "private fixture"], { cwd: source });
    await expect(exportPublic(source, target)).rejects.toThrow("Private information");
    await expect(readFile(join(target, "README.md"))).rejects.toThrow();
  });

  it("rejects destinations in the source and committed symlinks", async () => {
    await expect(exportPublic(source, join(source, "output"))).rejects.toThrow("outside");
    await symlink("../outside", join(source, "docs/link.md"));
    execFileSync("git", ["add", "docs/link.md"], { cwd: source });
    execFileSync("git", ["-c", "user.name=Export Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "symlink fixture"], { cwd: source });
    await expect(exportPublic(source, target)).rejects.toThrow("Unsupported export entry");
  });

  it("exports reviewed working changes and only explicitly included new files without changing Git", async () => {
    await writeFile(join(source, "README.md"), "# Updated preview\n");
    await writeFile(join(source, "LICENSE"), "License fixture\n");
    await writeFile(join(source, "NOTICE"), "Notice fixture\n");
    await chmod(join(source, "README.md"), 0o755);
    await writeFile(join(source, ".env.local"), "PRIVATE=untracked\n");
    await writeFile(join(source, "docs/manuscript.md"), "Untracked private draft\n");
    const status = execFileSync("git", ["status", "--porcelain"], { cwd: source }).toString();
    expect(await exportPublic(source, target, { workingTree: true, include: ["LICENSE", "NOTICE"] })).toBe(4);
    expect(await readFile(join(target, "README.md"), "utf8")).toBe("# Updated preview\n");
    expect(await readFile(join(target, "LICENSE"), "utf8")).toBe("License fixture\n");
    expect(await readFile(join(target, "NOTICE"), "utf8")).toBe("Notice fixture\n");
    expect((await lstat(join(target, "README.md"))).mode & 0o111).toBe(0o111);
    for (const path of [".env.local", ".git", "docs/manuscript.md", "docs/archive/report.md"]) {
      await expect(lstat(join(target, path))).rejects.toThrow();
    }
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: source }).toString()).toBe(status);
  });

  it("rejects excluded or escaping additions before creating the destination", async () => {
    for (const path of [".env.local", "../LICENSE", "/tmp/README.md", "docs/archive/report.md"]) {
      await expect(exportPublic(source, target, { workingTree: true, include: [path] })).rejects.toThrow("Excluded export path");
    }
    await expect(exportPublic(source, target, { include: ["LICENSE"] })).rejects.toThrow("require --working-tree");
    await expect(lstat(target)).rejects.toThrow();
  });

  it("rejects working tree symlinks including a symlinked parent", async () => {
    await rm(join(source, "README.md"));
    await symlink(join(source, ".env.example"), join(source, "README.md"));
    await expect(exportPublic(source, target, { workingTree: true })).rejects.toThrow("Unsupported export entry");
    await rm(join(source, "README.md"));
    await writeFile(join(source, "README.md"), "# Preview\n");
    await mkdir(join(directory, "private"));
    await writeFile(join(directory, "private/draft.md"), "Private text\n");
    await symlink(join(directory, "private"), join(source, "docs/linked"));
    await expect(exportPublic(source, target, { workingTree: true, include: ["docs/linked/draft.md"] })).rejects.toThrow("Unsupported export entry");
    await expect(lstat(target)).rejects.toThrow();
  });

  it("rejects a destination redirected into the source through a parent symlink", async () => {
    await symlink(source, join(directory, "alias"));
    await expect(exportPublic(source, join(directory, "alias/output"))).rejects.toThrow("outside");
    await expect(lstat(join(source, "output"))).rejects.toThrow();
  });

  it.each(["/Users/private-owner/source", "C:\\Users\\private-owner\\source", "private-owner@gmail.com"])(
    "requires review of private document content: %s", async (content) => {
      await writeFile(join(source, "README.md"), content);
      await expect(exportPublic(source, target, { workingTree: true })).rejects.toThrow("Private information");
      await expect(lstat(target)).rejects.toThrow();
    },
  );
});
