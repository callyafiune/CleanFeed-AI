import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      "dist-model-smoke",
      "dist-model-benchmark",
      // Built artifacts and the test-only rollout-variant dists written by
      // scripts/build-e2e-release-variants.mjs; never source.
      "test-results",
      "node_modules",
      "public/vendor/transformers-wasm",
      // Fake unpacked-extension fixtures used only to prove scripts/audit-build.mjs
      // rejects a bad build and passes a clean one. They are never source.
      "tests/fixtures/insecure-dist",
      "tests/fixtures/secure-dist-min",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node lab/ops scripts (.mjs): declare the runtime globals so no-undef
    // reflects reality instead of flagging console/process/URL.
    files: ["**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        URL: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        fetch: "readonly",
        setTimeout: "readonly",
        globalThis: "readonly",
      },
    },
  },
  {
    files: [
      "src/**/*.{ts,tsx}",
      "tests/**/*.{ts,tsx}",
      "contracts/**/*.{ts,tsx}",
    ],
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
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
);
