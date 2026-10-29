import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // Full navigations preserve the browser's unsaved-draft leave confirmation.
  { rules: { "@next/next/no-html-link-for-pages": "off" } },
  globalIgnores([".next/**", "node_modules/**", "next-env.d.ts"]),
]);
