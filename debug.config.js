const baseIgnore =
  "node_modules,.next,dist,build,.git,*.module.css,*.log,.env*,coverage";

module.exports = {
  full: {
    include: ["app/**"],
  },

  shared: {
    include: [
      // "lib/**",
      // "models/**",
      "utils/**",
      "middleware.js",
      "middleware.ts",
    ],
  },
  domains: {
    billing: [
      "app/api/billing/**",
      "app/api/bills/**",
      "app/api/billing-config/**",
      "app/api/billing-heads/**",
      "app/api/bill-template/**",
      "app/admin/generate-bills/**",
      "app/admin/generated-bills/**",
      "app/admin/import-bills/**",
      "app/admin/view-bills/**",
      "app/admin/billing-config/**",
      "app/admin/bill-template/**",
      "lib/billing-engine.js",
      "lib/pdf-generator.js",
      "lib/bill-status-manager.js",
      "lib/excel-handler.js",

      "models/Bill.js",
      "models/BillingHead.js",
      "models/Transaction.js",
    ],
    members: [
      "app/api/members/**",
      "app/admin/view-members/**",
      "app/admin/import-members/**",
      "models/Member.js",
    ],
    memberDashboard: [
      "app/member/**",

      "app/api/member/**",
      "app/api/ledger/**",
      "app/api/payments/**",
      "app/api/bills/**",
      "models/User.js",
      "models/Member.js",
    ],
    ledger: [
      "app/api/ledger/**",
      "app/admin/ledger/**",
      "app/member/my-ledger/**",
      "models/Transaction.js",
    ],
    // 🔵 PAYMENTS
    payments: [
      "app/api/payments/**",
      "app/admin/payments/**",
      "app/member/make-payment/**",
      "models/Transaction.js",
    ],

    // 🟣 AUTH (VERY IMPORTANT)
    auth: [
      "app/api/auth/**",
      "app/auth/**",

      "lib/jwt.js",
      "lib/mongodb.js",
      "middleware.js",
      "models/User.js",
    ],

    // 🟠 ADMIN SYSTEM
    admin: ["app/admin/**", "app/api/admin/**", "models/User.js"],
    superadmin: [
      "app/superadmin/**",
      "app/api/admin/**", // they use admin APIs
      "models/**",
    ],
    // 🟤 SOCIETY CORE
    society: [
      "app/api/society/**",
      "app/admin/society-config/**",
      "models/Society.js",
    ],

    // ⚫ DATABASE MANAGER
    db: ["app/api/db-manager/**", "app/admin/database-manager/**"],
  },

  baseIgnore,
};
