import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([".worktrees/**", ".next/**", "out/**", "coverage/**", "next-env.d.ts", "test-results/**", "playwright-report/**", "public/sw-assets.js"]),
]);
