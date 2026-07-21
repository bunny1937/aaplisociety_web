const nextJest = require("next/jest");
// next/jest reads jsconfig.json's `paths` (the "@/lib/*" alias used
// throughout lib/v1) and wires up the SWC transform automatically, so no
// separate babel config is needed for these ESM route/lib files.
const createJestConfig = nextJest({ dir: "./" });
const customJestConfig = {
  testEnvironment: "node",
  testMatch: ["**/tests/unit/**/*.unit.test.js"],
};
module.exports = createJestConfig(customJestConfig);
