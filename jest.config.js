const nextJest = require("next/jest");
// next/jest reads jsconfig.json's `paths` (the "@/lib/*" alias used
// throughout lib/v1) and wires up the SWC transform automatically, so no
// separate babel config is needed for these ESM route/lib files.
const createJestConfig = nextJest({ dir: "./" });
const customJestConfig = {
  testEnvironment: "node",
  testMatch: ["**/tests/unit/**/*.unit.test.js"],
  // next/jest does NOT actually read jsconfig.json's `paths` — it only maps
  // its own built-in aliases (next/font, css/image mocks, etc). Every "@/..."
  // import used throughout app/lib/models needs this mapped explicitly or
  // any test that imports real route/lib modules fails to resolve them.
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/$1" },
  setupFiles: ["<rootDir>/jest.setup.env.js"],
};
module.exports = createJestConfig(customJestConfig);
