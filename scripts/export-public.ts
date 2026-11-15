import { execFileSync } from "node:child_process";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, posix, sep } from "node:path";
import { fileURLToPath } from "node:url";

const rootFiles = new Set([
  ".env.example", ".gitignore", ".node-version", ".npmrc", "AGENTS.md",
  "README.md", "LICENSE", "NOTICE", "SECURITY.md", "package.json", "pnpm-lock.yaml",
  "eslint.config.mjs", "next.config.ts", "tsconfig.json", "vitest.config.ts",
  "start-editor.cmd", "start-editor.sh", "start-editor.command",
]);

export function isPublicPath(path: string): boolean {
  if (path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => !part || part === "." || part === "..")) return false;
  if (path.split("/").some((part) => part === ".." || part.startsWith("."))) {
    return rootFiles.has(path) || path === ".github/dependabot.yml" || path === ".github/workflows/ci.yml";
  }
  if (path === "docs/CODEX_IMPLEMENTATION_PROMPTS.md" || path === "docs/REQUIREMENTS_JP_MOBILE.md") return false;
  if (path.startsWith("docs/archive/") || path === "public/sw-assets.js") return false;
  return rootFiles.has(path) || /^playwright(?:\.[a-z]+)?\.config\.ts$/u.test(path)
    || /^(?:src|contracts|tests|skills|scripts|public|docs)\//u.test(path);
}

type ExportOptions = { workingTree?: boolean; include?: readonly string[] };

export async function exportPublic(source: string, destination: string, options: ExportOptions = {}): Promise<number> {
  const root = await realpath(source);
  const requestedTarget = resolve(destination);
  // Resolve the parent so a symlink cannot redirect an export into the source.
  const target = resolve(await realpath(dirname(requestedTarget)), basename(requestedTarget));
  const targetRelative = relative(root, target);
  if (!isAbsolute(targetRelative) && targetRelative !== ".." && !targetRelative.startsWith(`..${sep}`)) {
    throw new Error("Export destination must be outside the source repository.");
  }
  if (options.include?.length && !options.workingTree) throw new Error("Extra files require --working-tree.");
  for (const path of options.include ?? []) {
    if (!isPublicPath(path)) throw new Error(`Excluded export path: ${path}`);
  }
  const paths = execFileSync("git", ["ls-tree", "-r", "--name-only", "-z", "HEAD"], { cwd: root })
    .toString("utf8").split("\0").filter((path) => path && isPublicPath(path));
  const files: { path: string; contents: Buffer; executable: boolean }[] = [];
  for (const path of [...new Set([...paths, ...options.include ?? []])].sort()) {
    let contents: Buffer;
    let executable: boolean;
    if (options.workingTree) {
      const filename = resolve(root, path);
      const stat = await lstat(filename);
      if (!stat.isFile() || await realpath(filename) !== filename) throw new Error(`Unsupported export entry: ${path}`);
      contents = await readFile(filename);
      executable = (stat.mode & 0o111) !== 0;
    } else {
      const entry = execFileSync("git", ["ls-tree", "HEAD", "--", path], { cwd: root }).toString("utf8");
      if (!entry.startsWith("100644 blob ") && !entry.startsWith("100755 blob ")) throw new Error(`Unsupported export entry: ${path}`);
      contents = execFileSync("git", ["show", `HEAD:${path}`], { cwd: root, maxBuffer: 10 * 1024 * 1024 });
      executable = entry.startsWith("100755");
    }
    if (path.endsWith(".md")) {
      let text = contents.toString("utf8");
      if (/\/(?:home|Users)\/[^/\s]+\/|[A-Z]:\\Users\\|[a-z0-9._%+-]+@(?:outlook\.jp|outlook\.com|gmail\.com|hotmail\.com|yahoo\.co\.jp)/iu.test(text)) throw new Error(`Private information requires review: ${path}`);
      // Historical reports are kept privately; their link labels remain readable.
      text = text.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/gu, (match: string, label: string, link: string) => {
        const linked = posix.normalize(posix.join(posix.dirname(path), link.split("#")[0]));
        return linked.startsWith("docs/archive/") ? `${label}（開発履歴・配布対象外）` : match;
      });
      contents = Buffer.from(text);
    }
    files.push({ path, contents, executable });
  }
  // Refuse to overwrite an older export, and validate everything before writing.
  await mkdir(target, { recursive: false, mode: 0o700 });
  for (const file of files) {
    const filename = resolve(target, file.path);
    await mkdir(dirname(filename), { recursive: true });
    await writeFile(filename, file.contents, { flag: "wx", mode: file.executable ? 0o755 : 0o644 });
  }
  return files.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const destination = process.argv[2];
  const flags = process.argv.slice(3);
  if (!destination || flags.some((flag) => flag !== "--working-tree" && !flag.startsWith("--include="))) {
    throw new Error("Usage: node scripts/export-public.ts /absolute/path/to/new-folder [--working-tree --include=LICENSE --include=NOTICE]");
  }
  const workingTree = flags.includes("--working-tree");
  const include = flags.filter((flag) => flag.startsWith("--include=")).map((flag) => flag.slice("--include=".length));
  const count = await exportPublic(fileURLToPath(new URL("../", import.meta.url)), destination, { workingTree, include });
  console.log(`Exported ${count} files from ${workingTree ? "working tree and explicitly included files" : "committed HEAD"}. No Git history was copied.`);
}
