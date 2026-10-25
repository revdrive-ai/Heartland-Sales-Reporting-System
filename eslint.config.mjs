import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    /* The React Compiler rules that eslint-config-next 16 turned on flag the
       hydration pattern this app uses throughout (read localStorage / fetch
       in a mount effect, then setState) and a ref written from an event
       handler. They are advice about render performance, not defects, and
       cleaning them up is a refactor of BaseView and PlanBook in its own
       right — so they report as warnings until that refactor lands. */
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/refs": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
