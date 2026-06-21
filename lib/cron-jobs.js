const cron = require("node-cron");
const fetch = require("node-fetch");

// ✅ JOB 1: Mark overdue bills (runs at 12:01 AM daily)
cron.schedule("1 0 * * *", async () => {
  console.log("[CRON] Marking overdue bills...");
  try {
    const res = await fetch("http://localhost:3000/api/bills/mark-overdue", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });
    const data = await res.json();
    console.log("[CRON] Mark overdue result:", data);
  } catch (error) {
    console.error("[CRON] Mark overdue failed:", error);
  }
});

// ✅ JOB 2: Calculate interest (runs at 12:05 AM daily)
cron.schedule("5 0 * * *", async () => {
  console.log("[CRON] Running interest calculation...");
  try {
    const res = await fetch(
      "http://localhost:3000/api/ledger/calculate-interest",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
    const data = await res.json();
    console.log("[CRON] Interest calculation result:", data);
  } catch (error) {
    console.error("[CRON] Interest calculation failed:", error);
  }
});

// ✅ JOB 3: Auto-push Scheduled bills when their pushDate is reached (runs at 12:10 AM daily)
cron.schedule("10 0 * * *", async () => {
  console.log("[CRON] Pushing scheduled bills...");
  try {
    const res = await fetch("http://localhost:3000/api/bills/push-scheduled", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = await res.json();
    console.log("[CRON] Push scheduled result:", data);
  } catch (error) {
    console.error("[CRON] Push scheduled failed:", error);
  }
});

// JOB 4: Auto-close rejected complaints with 3 days of inactivity
cron.schedule("30 0 * * *", async () => {
  console.log("CRON: Auto-closing inactive complaint threads...");
  try {
    const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const result = await fetch(
      "http://localhost:3000/api/complaints/admin/auto-close",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
    );
    const data = await result.json();
    console.log("CRON: Auto-close result:", data);
  } catch (error) {
    console.error("CRON: Auto-close failed:", error);
  }
});
// Visitor approval timeout — runs every 2 minutes
// Flips Pending visitors to Expired if expiresAt has passed
cron.schedule("*/2 * * * *", async () => {
  try {
    const result = await Visitor.updateMany(
      { status: "Pending", expiresAt: { $lt: new Date() } },
      { $set: { status: "Expired" } },
    );
    if (result.modifiedCount > 0)
      console.log(`[Cron] Expired ${result.modifiedCount} pending visitor(s)`);
  } catch (err) {
    console.error("[Cron] Visitor expiry error", err);
  }
});
console.log("Cron jobs scheduled");
console.log("  - Mark overdue bills:    12:01 AM daily");
console.log("  - Calculate interest:    12:05 AM daily");
console.log("  - Push scheduled bills:  12:10 AM daily");
