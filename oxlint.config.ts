import { defineConfig } from "oxlint";

import type { DummyRuleMap, OxlintConfig } from "oxlint";

const generalPlugins: NonNullable<OxlintConfig["plugins"]> = [
  "eslint",
  "unicorn",
  "oxc",
  "import",
  "promise",
];
const sharedPlugins: NonNullable<OxlintConfig["plugins"]> = [...generalPlugins, "typescript"];
const reactPlugins: NonNullable<OxlintConfig["plugins"]> = [...sharedPlugins, "react", "jsx-a11y"];
const typeScriptExtensions = ["ts", "tsx"] as const;
const nodeExtensions = ["js", "mjs", "ts"] as const;

function filesWithExtensions(pattern: string, extensions: readonly string[]): string[] {
  return extensions.map((extension) => `${pattern}.${extension}`);
}

const typeScriptFiles = [
  ...filesWithExtensions("*", typeScriptExtensions),
  ...filesWithExtensions("**/*", typeScriptExtensions),
];
const testFiles = filesWithExtensions("**/*.test", typeScriptExtensions);
const testAndSpecFiles = [...testFiles, ...filesWithExtensions("**/*.spec", typeScriptExtensions)];
const webSourceFiles = filesWithExtensions("apps/web/src/**/*", typeScriptExtensions);
const siteSourceFiles = filesWithExtensions("apps/site/src/**/*", typeScriptExtensions);
const nodeSourceFiles = [
  ...filesWithExtensions("apps/agent-ts/**/*", typeScriptExtensions),
  ...filesWithExtensions("apps/hub/**/*", typeScriptExtensions),
  ...filesWithExtensions("packages/**/*", typeScriptExtensions),
];
const antiSlopRules = {
  "anti-slop/no-chained-type-assertions": "error",
  "anti-slop/no-conditional-empty-object-spread": "error",
  "anti-slop/no-known-value-widening": "error",
  "anti-slop/no-module-mocking": "error",
  "anti-slop/no-object-parameters": "error",
  "anti-slop/no-reflect-apply": "error",
  "anti-slop/no-reflect-get": "error",
  "anti-slop/no-runtime-typeof": "error",
  "anti-slop/no-shape-in-symbol-names": "error",
  "anti-slop/no-unknown-returns": "error",
  "anti-slop/no-unknown-type-aliases": "error",
  "anti-slop/no-unsafe-dictionary-type": "error",
  "anti-slop/no-widen-then-assert": "error",
  "anti-slop/require-safety-comment-for-type-assertion": "error",
} satisfies DummyRuleMap;
const effectRules = {
  "react-you-might-not-need-an-effect/no-adjust-state-on-prop-change": "error",
  "react-you-might-not-need-an-effect/no-chain-state-updates": "error",
  "react-you-might-not-need-an-effect/no-derived-state": "error",
  "react-you-might-not-need-an-effect/no-event-handler": "error",
  "react-you-might-not-need-an-effect/no-external-store-subscription": "error",
  "react-you-might-not-need-an-effect/no-initialize-state": "error",
  "react-you-might-not-need-an-effect/no-pass-data-to-parent": "error",
  "react-you-might-not-need-an-effect/no-pass-live-state-to-parent": "error",
  "react-you-might-not-need-an-effect/no-reset-all-state-on-prop-change": "error",
} satisfies DummyRuleMap;
const e18eRules = {
  "e18e/prefer-array-at": "error",
  "e18e/prefer-array-fill": "error",
  "e18e/prefer-array-from-map": "error",
  "e18e/prefer-array-some": "error",
  "e18e/prefer-date-now": "error",
  "e18e/prefer-includes": "error",
  "e18e/prefer-nullish-coalescing": "error",
  "e18e/prefer-object-has-own": "error",
  "e18e/prefer-regex-test": "error",
  "e18e/prefer-spread-syntax": "error",
  "e18e/prefer-static-regex": "error",
  "e18e/prefer-string-fromcharcode": "error",
  "e18e/prefer-timer-args": "error",
} satisfies DummyRuleMap;
const reactCompilerCorrectnessRules = {
  "react/error-boundaries": "error",
  "react/globals": "error",
  "react/immutability": "error",
  "react/incompatible-library": "error",
  "react/preserve-manual-memoization": "error",
  "react/purity": "error",
  "react/refs": "error",
  "react/set-state-in-effect": "error",
  "react/set-state-in-render": "error",
  "react/static-components": "error",
  "react/use-memo": "error",
  "react/void-use-memo": "error",
} satisfies DummyRuleMap;
const reactCompilerBailoutRules = {
  "react/capitalized-calls": "error",
  "react/hooks": "error",
  "react/invariant": "error",
  "react/memo-dependencies": "error",
  "react/no-deriving-state-in-effects": "error",
  "react/rule-suppression": "error",
  "react/syntax": "error",
  "react/todo": "error",
  "react/unsupported-syntax": "error",
} satisfies DummyRuleMap;

export default defineConfig({
  categories: {
    correctness: "error",
    suspicious: "error",
  },
  options: {
    denyWarnings: true,
    reportUnusedDisableDirectives: "error",
    typeAware: true,
  },
  ignorePatterns: [
    ".agent/**",
    ".claude/**",
    ".codex/**",
    ".cursor/**",
    ".gemini/**",
    ".playwright-cli/**",
    "coverage",
    "dist",
    "node_modules",
    "tools/oxlint/anti-slop/**",
    "apps/web/src/routeTree.gen.ts",
  ],
  jsPlugins: [
    "@stylistic/eslint-plugin",
    { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
    { name: "e18e", specifier: "@e18e/eslint-plugin" },
    {
      name: "react-you-might-not-need-an-effect",
      specifier: "eslint-plugin-react-you-might-not-need-an-effect",
    },
  ],
  plugins: sharedPlugins,
  env: {
    es2022: true,
  },
  rules: {
    ...antiSlopRules,
    "@stylistic/padding-line-between-statements": [
      "error",
      { blankLine: "always", prev: "multiline-block-like", next: "*" },
      { blankLine: "always", prev: "*", next: "multiline-block-like" },
      { blankLine: "always", prev: "*", next: "return" },
    ],
    "eslint/curly": ["error", "all"],
    "eslint/eqeqeq": ["error", "always"],
    "eslint/no-unused-vars": [
      "error",
      {
        args: "all",
        argsIgnorePattern: "^_",
        caughtErrors: "all",
        caughtErrorsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        ignoreRestSiblings: true,
      },
    ],
    "eslint/no-use-before-define": [
      "error",
      {
        functions: true,
        classes: true,
        variables: true,
        allowNamedExports: false,
      },
    ],
    "import/first": "error",
    "import/no-duplicates": "error",
    "import/no-unassigned-import": ["error", { allow: ["**/*.css"] }],
    "oxc/no-accumulating-spread": "error",
    "unicorn/no-nested-ternary": "error",
    "unicorn/require-module-specifiers": "error",
    // Effect discriminates tagged errors and unions with `_tag`.
    "eslint/no-underscore-dangle": ["error", { allow: ["_tag"] }],
    // Keeping small helpers near their use is preferred to hoisting them away from their context.
    "unicorn/consistent-function-scoping": "off",
  },
  overrides: [
    {
      files: typeScriptFiles,
      rules: {
        "typescript/ban-ts-comment": "error",
        "typescript/consistent-type-imports": "error",
        "typescript/no-explicit-any": "error",
        "typescript/no-floating-promises": "error",
        "typescript/no-non-null-assertion": "error",
        "typescript/no-unsafe-argument": "error",
        "typescript/no-unsafe-assignment": "error",
        "typescript/no-unsafe-call": "error",
        "typescript/no-unsafe-member-access": "error",
        "typescript/no-unsafe-return": "error",
        "typescript/no-unsafe-type-assertion": "error",
        "typescript/no-unnecessary-condition": "error",
        "typescript/prefer-readonly": "error",
        "typescript/switch-exhaustiveness-check": "error",
      },
    },
    {
      files: testFiles,
      plugins: [...sharedPlugins, "vitest"],
      rules: {
        "vitest/no-conditional-expect": "error",
        // `@effect/vitest` runs Effect-returning tests through `it.effect`.
        "vitest/no-standalone-expect": ["error", { additionalTestBlockFunctions: ["it.effect"] }],
      },
    },
    {
      files: webSourceFiles,
      env: { browser: true },
      plugins: reactPlugins,
      rules: {
        ...reactCompilerBailoutRules,
        ...reactCompilerCorrectnessRules,
        "jsx-a11y/no-noninteractive-tabindex": ["error", { roles: ["region", "tabpanel"] }],
        // `output` is not a general replacement for status, group or composite-widget roles.
        "jsx-a11y/prefer-tag-over-role": "off",
        "react/exhaustive-deps": "error",
        "react/exhaustive-effect-dependencies": "error",
        "react/no-array-index-key": "error",
        // React 19 uses the automatic JSX runtime.
        "react/react-in-jsx-scope": "off",
      },
    },
    {
      files: webSourceFiles,
      excludeFiles: testAndSpecFiles,
      rules: {
        ...effectRules,
        ...e18eRules,
      },
    },
    {
      files: siteSourceFiles,
      env: { browser: true },
      rules: e18eRules,
    },
    {
      files: nodeSourceFiles,
      env: { node: true },
      plugins: [...sharedPlugins, "node"],
    },
    {
      files: [
        ...filesWithExtensions("*.config", nodeExtensions),
        ...filesWithExtensions("**/*.config", nodeExtensions),
        ...filesWithExtensions("apps/*/scripts/**/*", nodeExtensions),
        ...filesWithExtensions("scripts/**/*", nodeExtensions),
      ],
      env: { node: true },
      plugins: [...sharedPlugins, "node"],
    },
  ],
  settings: {
    react: { version: "19.3.0" },
  },
});
