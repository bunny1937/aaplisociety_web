// lib/load-env.js
//
// Loads .env, .env.local, .env.<mode>, .env.<mode>.local — the same files
// and precedence Next.js's own dev/build pipeline uses — via @next/env's
// loadEnvConfig (Next's own implementation of that loading order).
//
// Why this needs its own file: in real ES modules, ALL of an entry file's
// static `import`s are evaluated before any of that entry file's OWN
// top-level statements run, even ones written textually above later
// `import` lines. So a bare `loadEnvConfig(...)` call placed directly in
// server.js — even as the very first line — still executes too late,
// after sibling imports like `./socket-server.js` (which imports
// `./redis.js`, which reads `process.env.UPSTASH_REDIS_REST_URL` at
// module-evaluation time) have already run.
//
// Importing *this* file first makes the loadEnvConfig call part of a
// sibling import's own module body instead of the entry file's inline
// code, and sibling imports evaluate strictly in source order — so this
// file's side effect (populating process.env) completes before the next
// import in server.js is reached.
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

