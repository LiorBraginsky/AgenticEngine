import tseslint from "typescript-eslint";

export default tseslint.config(
  ...tseslint.configs.recommended,
  { ignores: ["node_modules", "dist", "**/dist", "**/*.d.ts", "**/src-tauri/target"] },
);
