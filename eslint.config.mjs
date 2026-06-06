import js from "@eslint/js";
import globals from "globals";
import prettier from "eslint-config-prettier";

// Flat config. The frontend is plain browser ES modules served via Go embed,
// so there is no bundler — just lint the source under static/js. `prettier`
// is listed last to switch off stylistic rules that Prettier owns.
export default [
  js.configs.recommended,
  {
    files: ["static/js/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
      },
    },
  },
  prettier,
];
