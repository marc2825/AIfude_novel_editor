// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isPublicPath } from "../../scripts/export-public";

describe("public source export boundary", () => {
  it.each([".git/config", ".env", ".env.local", ".worktrees/jp/package.json", "node_modules/package.json", ".next/server/app/page.html", "next-env.d.ts", "docs/archive/SELF_REVIEW.md", "docs/REQUIREMENTS_JP_MOBILE.md", "docs/CODEX_IMPLEMENTATION_PROMPTS.md", "novel-ai-editor-design/novel-ai-editor-design/README.md", "public/sw-assets.js", "src/../../.env", "src/.credentials/key.json", "/tmp/README.md", "src/..\\secret.txt", "src//secret.txt", "src/./secret.txt", ""])(
    "does not export %s", (path) => expect(isPublicPath(path)).toBe(false),
  );
  it.each([".env.example", ".github/dependabot.yml", ".github/workflows/ci.yml", "pnpm-lock.yaml", "LICENSE", "NOTICE", "src/proxy.ts", "tests/fixtures/contracts/llm-candidates.schema.ts", "public/icons/source.svg", "docs/PUBLISHING.md", "start-editor.sh"])(
    "exports %s", (path) => expect(isPublicPath(path)).toBe(true),
  );
});
