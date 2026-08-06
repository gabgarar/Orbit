import unusedImports from "eslint-plugin-unused-imports";

export default [
    {
        ignores: [
            "node_modules/**",
            "../server/node_modules/**",
            "../front/dist/**",
            "../react-ui/dist/**",
            "../site/**",
            "../tests/artifacts/**"
        ]
    },
    {
        files: ["**/*.{js,jsx}"],
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
