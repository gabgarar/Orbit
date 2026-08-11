import { createRequire } from "node:module";

// JavaScript tooling is installed under `server`, while the lint target spans
// the legacy runtime, React UI, and Node gateway. Resolve the plugin from the
// package that owns it while keeping the flat config at repository scope.
const requireFromServer = createRequire(new URL("./server/package.json", import.meta.url));
const unusedImports = requireFromServer("eslint-plugin-unused-imports");

export default [
    {
        ignores: [
            "**/node_modules/**",
            "front/dist/**",
            "react-ui/dist/**",
            "react-ui/.runtime-vendor/**",
            "site/**",
            "server/tests/artifacts/**",
            "server/ui-artifacts/**"
        ]
    },
    {
        files: [
            "front/**/*.{js,jsx}",
            "react-ui/src/**/*.{js,jsx}",
            "server/src/**/*.{js,jsx}",
            "server/tests/**/*.{js,jsx}"
        ],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            parserOptions: { ecmaFeatures: { jsx: true } }
        },
        plugins: { "unused-imports": unusedImports },
        rules: {
            "no-unused-vars": "off",
            "unused-imports/no-unused-imports": "error",
            "unused-imports/no-unused-vars": ["warn", {
                vars: "all",
                varsIgnorePattern: "^_",
                args: "after-used",
                argsIgnorePattern: "^_"
            }]
        }
    }
];
