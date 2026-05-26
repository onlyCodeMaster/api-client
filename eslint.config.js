// ESLint v9 flat config. Targets the React + TypeScript frontend in `src/`.
//
// Intentionally light-weight: type-aware rules are disabled because they
// roughly double CI time and the project doesn't yet have the test coverage
// to make `no-floating-promises` style enforcement worth it. We can layer
// those in later by switching from `tseslint.configs.recommended` to
// `tseslint.configs.recommendedTypeChecked` and pointing at tsconfig.

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist", "src-tauri/target", "node_modules", "coverage"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: { ...globals.browser, ...globals.es2020 },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      // The codebase pre-dates lint enforcement; tolerate the most common
      // legacy patterns so this PR can ship a green baseline. Each can be
      // re-enabled in a focused follow-up once we have time to clean up.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-empty-object-type": "off",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-useless-escape": "warn",
      "prefer-const": "warn",
      // react-hooks v6 ships new rules that flag patterns deeply embedded
      // in the existing codebase (workspace switching effects, OAuth token
      // expiry render math, etc.). Downgrade to warn so CI stays green
      // while individual surfaces get refactored in follow-up PRs.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/rules-of-hooks": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    // Vitest tests get the test globals.
    files: ["**/*.test.ts", "**/*.test.tsx"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.es2020, ...globals.node },
    },
  },
);
