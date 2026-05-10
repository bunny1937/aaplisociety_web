#!/usr/bin/env node
/**
 * Redis Cache Test Script
 * Tests all 13 batch API endpoints
 * Runs 3 rounds with 1s pause between each endpoint
 */

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
const TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2OWU4ZjJmMWUwYThhYzY3N2UyY2RmMjgiLCJlbWFpbCI6ImdvZGJvbGVAZ21haWwuY29tIiwicm9sZSI6IkFkbWluIiwic29jaWV0eUlkIjoiNjllOGYyZjBlMGE4YWM2NzdlMmNkZjFlIiwibWVtYmVySWQiOm51bGwsImlhdCI6MTc3Njg3NDI1OSwiZXhwIjoxNzc3NDc5MDU5fQ.Xb1AI4HZnMcwQOfDxo80FYS34UnpHVcK79T_YUcKbQ4";
const ADMIN_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2OTUzZDczZTRiZTllMzJlOWMzZjAyNmYiLCJlbWFpbCI6ImFhcGxpc29jaWV0eTIwMjVAZ21haWwuY29tIiwicm9sZSI6IlN1cGVyQWRtaW4iLCJpYXQiOjE3NzY4OTcyNjksImV4cCI6MTc3NjkyNjA2OX0.P3xY2xs-2wOZxK56FSaU-CfKa7GUEqwgsr0SkaPLzwc";
const MEMBER_ID = "69e8f8ede0a8ac677e2ce03c";

const ROUNDS = 3;
const PAUSE_MS = 1000;

const endpoints = [
  {
    name: "BATCH 1  — members/list",
    url: `/api/members/list?page=1&limit=100`,
    token: TOKEN,
  },
  { name: "BATCH 4  — payments/list", url: `/api/payments/list`, token: TOKEN },
  {
    name: "BATCH 5  — payments/outstanding",
    url: `/api/payments/outstanding?fetch&memberId=${MEMBER_ID}`,
    token: TOKEN,
  },
  {
    name: "BATCH 6  — ledger/fetch",
    url: `/api/ledger/fetch?memberId=${MEMBER_ID}&page=1`,
    token: TOKEN,
  },
  {
    name: "BATCH 7  — society/config",
    url: `/api/society/config`,
    token: TOKEN,
  },
  { name: "BATCH 9  — billing/list", url: `/api/billing/list`, token: TOKEN },
  {
    name: "BATCH 10 — billing/generated",
    url: `/api/billing/generated`,
    token: TOKEN,
  },
  {
    name: "BATCH 11 — admin/stats",
    url: `/api/admin/stats`,
    token: ADMIN_TOKEN,
  },
  {
    name: "BATCH 13 — billing-heads/list",
    url: `/api/billing-heads/list`,
    token: TOKEN,
  },
  {
    name: "member/bills",
    url: `/api/member/bills?page=1&limit=20`,
    token: TOKEN,
  },
  {
    name: "member/ledger",
    url: `/api/member/ledger?page=1&limit=20`,
    token: TOKEN,
  },
  { name: "bill-template/get", url: `/api/bill-template/get`, token: TOKEN },
  {
    name: "bill-template/get-full",
    url: `/api/bill-template/get-full`,
    token: TOKEN,
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (ms) => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`);
const c = {
  green: (t) => `\x1b[32m${t}\x1b[0m`,
  red: (t) => `\x1b[31m${t}\x1b[0m`,
  yellow: (t) => `\x1b[33m${t}\x1b[0m`,
  cyan: (t) => `\x1b[36m${t}\x1b[0m`,
  bold: (t) => `\x1b[1m${t}\x1b[0m`,
  dim: (t) => `\x1b[2m${t}\x1b[0m`,
};

async function testEndpoint(ep, round) {
  const start = Date.now();
  try {
    const res = await fetch(`${BASE_URL}${ep.url}`, {
      headers: {
        Authorization: `Bearer ${ep.token}`,
        "Content-Type": "application/json",
        "x-admin-api-key": process.env.ADMIN_API_KEY || "",
      },
    });
    const elapsed = Date.now() - start;
    const text = await res.text();
    const size = `${(text.length / 1024).toFixed(1)}KB`;

    const roundLabel =
      round === 1 ? c.yellow("MISS→STORE") : c.green("HIT (Redis)");
    const speed =
      elapsed < 80
        ? c.green(`⚡ ${fmt(elapsed)}`)
        : elapsed < 300
          ? c.cyan(`✓ ${fmt(elapsed)}`)
          : c.yellow(`⚠ ${fmt(elapsed)}`);
    const status = res.ok ? c.green(`${res.status}`) : c.red(`${res.status}`);

    console.log(
      `  ${status} | ${speed.padEnd(20)} | ${roundLabel} | ${c.dim(size.padEnd(8))} | ${ep.name}`,
    );
    return { ok: res.ok, elapsed, status: res.status };
  } catch (err) {
    const elapsed = Date.now() - start;
    console.log(
      `  ${c.red("ERR")} | ${fmt(elapsed).padEnd(20)} | ${c.red("FAILED")} | ${ep.name} — ${err.message}`,
    );
    return { ok: false, elapsed, status: 0 };
  }
}

async function runRound(round, allResults) {
  const line = "═".repeat(65);
  console.log(c.dim(`\n${line}`));
  const label =
    round === 1
      ? c.yellow("  (expect CACHE MISS — storing to Redis)")
      : c.green("  (expect CACHE HIT — reading from Redis)");
  console.log(`${c.bold(`  ROUND ${round} of ${ROUNDS}`)}${label}`);
  console.log(c.dim(line));

  for (let i = 0; i < endpoints.length; i++) {
    const result = await testEndpoint(endpoints[i], round);
    allResults[i] = allResults[i] || [];
    allResults[i].push(result.elapsed);
    await sleep(PAUSE_MS);
  }
}

async function main() {
  const line = "═".repeat(65);
  console.log(c.bold("\n🔴 REDIS CACHE TEST RUNNER"));
  console.log(c.dim(`Base URL : ${BASE_URL}`));
  console.log(c.dim(`Endpoints: ${endpoints.length}`));
  console.log(c.dim(`Rounds   : ${ROUNDS}`));
  console.log(c.dim(`Pause    : ${PAUSE_MS}ms between each endpoint`));

  if (!TOKEN) {
    console.log(c.yellow("\n⚠️  No TOKEN set. Usage:"));
    console.log(
      c.dim(
        "   TEST_TOKEN=eyJ... TEST_ADMIN_TOKEN=eyJ... TEST_MEMBER_ID=abc123 node test-cache.mjs",
      ),
    );
  }

  const allResults = [];

  for (let round = 1; round <= ROUNDS; round++) {
    await runRound(round, allResults);
    if (round < ROUNDS) {
      console.log(c.dim(`\n  ⏳ Waiting 2s before round ${round + 1}...`));
      await sleep(2000);
    }
  }

  // Summary table
  console.log(c.dim(`\n${line}`));
  console.log(c.bold("  SUMMARY — Response times (ms) across rounds"));
  console.log(c.dim(line));
  console.log(
    c.dim(
      `  ${"Endpoint".padEnd(38)} ${"R1".padStart(7)} ${"R2".padStart(7)} ${"R3".padStart(7)}  Speedup`,
    ),
  );
  console.log(c.dim(`  ${"-".repeat(62)}`));

  endpoints.forEach((ep, i) => {
    const times = allResults[i] || [];
    const r1 = times[0] || 0;
    const r2 = times[1] || 0;
    const r3 = times[2] || 0;
    const speedup =
      r1 > 0 && r2 > 0
        ? `${Math.round(((r1 - r2) / r1) * 100)}% faster`
        : "N/A";
    const name = (ep.name || ep.label || "unknown")
      .replace(/BATCH \d+ — /, "")
      .padEnd(38);
    console.log(
      `  ${c.dim(name)} ` +
        `${c.yellow(fmt(r1).padStart(7))} ` +
        `${c.green(fmt(r2).padStart(7))} ` +
        `${c.green(fmt(r3).padStart(7))}  ` +
        c.cyan(speedup),
    );
  });

  console.log(c.dim(`\n${line}`));
  console.log(
    c.green("  ✅ Done. Check your Redis dashboard for memory usage."),
  );
  console.log(
    c.dim("  💡 Local Redis: redis-cli KEYS * to see all cached keys"),
  );
  console.log(c.dim(`${line}\n`));
}

main().catch(console.error);
