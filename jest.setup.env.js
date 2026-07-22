// next/jest deliberately skips .env.local under NODE_ENV=test (mirrors CRA,
// keeps local secrets out of CI env-loading order). Our integration tests
// need the real MONGODB_URI/ADMIN_JWT_SECRET from .env.local, so load it
// explicitly here rather than changing Next's env-loading behavior globally.
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env.local") });
