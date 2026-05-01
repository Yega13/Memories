import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

// `eslint-config-next` still ships in legacy CJS shape ({ extends: [...] }),
// not flat-config. FlatCompat bridges that into the flat-config world that
// ESLint 9 expects. This is the layout `create-next-app` scaffolds for
// Next 15 — switching to it because the previous `import x from
// "eslint-config-next/core-web-vitals.js"` + spread does not work against
// the current package.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default eslintConfig;
