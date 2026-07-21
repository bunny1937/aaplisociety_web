
Aapli Society — Society ERP and Mobile API
Aapli Society is a multi-role society-management platform built with Next.js, MongoDB, and Flutter. The Next.js application serves the website, administrative dashboards, the web APIs, and the versioned mobile API from one deployment and one database.

Overview
The platform supports the day-to-day workflows of housing societies across four primary roles:

Super Admin — society management, audit reports, exports, data inspection, credential resets, and platform-level operations.
Society Admin / Secretary / Accountant — members, billing, payments, ledger, notices, complaints, visitors, tenancy, reports, and society configuration.
Member / Resident — bills, payments, receipts, ledger, notices, complaints, profile, and visitor approvals.
Security Guard — visitor entry/exit, pass verification, resident approval, SOS, and offline-entry workflows.
The website remains available through /api/*. The Flutter application uses the versioned /v1/* contract, which is rewritten internally to /api/v1/*.

Architecture
Flutter mobile app
       |
       |  HTTPS: /v1/*
       v
Next.js / Vercel deployment
       |
       |-- Website and dashboards
       |-- Web API: /api/*
       |-- Mobile API: /api/v1/*
       |-- Shared notification and FCM services
       |-- Vercel Cron endpoints
       v
MongoDB Atlas (shared collections)
One deployment, two API contracts
Web clients use /api/*, including the full administration, billing, import/export, and reporting surface.
Mobile clients use /v1/*, rewritten to /api/v1/* by next.config.js locally and vercel.json on Vercel.
Both API namespaces connect to the same MongoDB database and collections.
The separate URL contracts preserve compatibility with the existing website and Flutter client while allowing shared services to be extracted gradually.
Main features
Authentication and tenancy
Cookie-based web authentication.
Bearer access and refresh tokens for the mobile client.
Multi-society profile selection and profile switching.
Role- and society-scoped access control.
Password change, forgot-password, and reset-password flows.
Member and society administration
Member import, validation, duplicate handling, and credential generation.
Society setup and configuration.
Profile-edit and tenancy-request approval workflows.
Security-guard administration.
Audit logs, exports, and database-management tools.
Billing and accounting
Billing heads and billing configuration.
Bill generation, Excel import, PDF generation, and scheduled bill workflows.
Payment recording and payment imports.
Interest-first payment allocation.
Ledger, receipts, balance sheet, overdue balances, and exports.
Safety gates for sensitive mobile write operations.
Notices and complaints
Society notices with type, priority, pinning, expiry, view, and acknowledgement support.
Member complaint creation and administrative approval/rejection workflows.
In-app notification records for notice and workflow events.
Visitor and security workflows
Visitor request, approval, denial, entry, exit, reminders, and reassignment.
Visitor passes and QR/pass verification.
Guard requests, SOS handling, blacklisting, and audit logs.
Offline visitor-entry support.
Scheduled visitor escalation.
Notifications
Notification rows are persisted in MongoDB for the website and mobile notification centre.
Mobile clients poll GET /v1/notifications?since=<ISO> every 20 seconds for serverless-compatible realtime updates.
Firebase Cloud Messaging is used for Android/iOS push delivery.
Mobile devices register tokens using POST /v1/devices and remove them using DELETE /v1/devices/:fcmToken.
Notice creation from both /api/notices and /v1/notices uses the shared lib/v1/notify.js notification path.
Current push status: backend Firebase credentials, notification persistence, and notice fan-out are configured. The latest diagnostic found zero rows in devicetokens, so closed/background push delivery remains blocked until the Flutter runtime successfully obtains an FCM token and registers it through POST /v1/devices. In-app notifications continue to work through persisted notification rows and polling.

Mobile API
The mobile API currently contains 49 Next.js route handlers.

Authentication
POST /v1/auth/login
POST /v1/auth/refresh
POST /v1/auth/switch-profile
GET /v1/auth/me
GET /v1/auth/members
POST /v1/auth/change-password
POST /v1/auth/forgot-password
POST /v1/auth/reset-password
Community
/v1/notices
/v1/complaints
/v1/complaints/:id/status
/v1/notifications
/v1/notifications/:id/mark-read
/v1/notifications/mark-all-read
Billing
/v1/bills
/v1/bills/:id/pay
/v1/ledger
/v1/receipts
/v1/rent-payments
Visitors and security
/v1/visitors
/v1/visitors/:id
/v1/visitors/:id/decision
/v1/visitors/:id/deny
/v1/visitors/:id/enter
/v1/visitors/:id/exit
/v1/visitors/:id/note
/v1/visitors/:id/reassign
/v1/visitors/:id/remind
/v1/visitors/:id/upload-photo
/v1/visitors/flats/search
/v1/visitors/guard-request
/v1/visitors/guard-sos
/v1/visitors/offline-entry
/v1/visitors/pass
/v1/visitors/pass/verify
/v1/visitors/passes
/v1/visitors/sos
/v1/security/guards
/v1/security/message
Tenancy and profile requests
/v1/tenant-requests
/v1/tenant-requests/upload/:field
/v1/tenant-requests/:id/confirm-move-out
/v1/tenant-history
/v1/profile-edit-requests
Device registration and jobs
POST /v1/devices
DELETE /v1/devices/:fcmToken
/v1/cron/escalate-visitors
/v1/cron/lease-expiry
See V1_MIGRATION.md for migration details and compatibility notes.

Technology stack
Frontend and backend: Next.js 15, React 19, Next.js Route Handlers
Database: MongoDB Atlas with Mongoose
Mobile client: Flutter
Authentication: JWT access/refresh tokens and HTTP-only cookies
Push: Firebase Admin SDK / Firebase Cloud Messaging
Files: S3-compatible Cloudflare R2 storage
Email: Brevo
Validation: Zod
Testing: Playwright and Jest
Deployment: Vercel
Local setup
Requirements
Node.js 20 or newer
npm
MongoDB Atlas database
Firebase service account for push delivery
Optional R2 and Brevo credentials for file/email features
Install
git clone <repository-url>
cd AapliSocietyy
npm install
Create .env.local and add the required environment variables. Never commit real secrets.

MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/<database>
JWT_SECRET=<strong-secret>
REFRESH_SECRET=<different-strong-secret>
ACCESS_TTL=15m
REFRESH_TTL=30d

# Choose either one JSON credential or the three split Firebase variables.
FIREBASE_SA_JSON={"type":"service_account","project_id":"..."}
# FIREBASE_PROJECT_ID=...
# FIREBASE_CLIENT_EMAIL=...
# FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

R2_ENDPOINT=...
R2_BUCKET=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...

BREVO_API_KEY=...
BREVO_SENDER_EMAIL=...
BREVO_SENDER_NAME=...

CRON_SECRET=...
BILL_WRITES_ENABLED=false
COMPLAINT_STATUS_WRITES_ENABLED=false
Start development:

npm run dev
Open http://localhost:3000.

MongoDB connection resilience
The MongoDB helper caches the Mongoose connection, uses explicit timeouts, and retries transient connection failures. If SRV DNS is unreliable on a development network, use the Atlas standard multi-host mongodb:// connection string or correct the local DNS/network path rather than committing credentials.

Flutter local configuration
Android emulator:

flutter run --dart-define=FLAVOR=dev --dart-define=API_BASE_URL=http://10.0.2.2:3000/v1
Physical Android device on the same network:

flutter run --dart-define=FLAVOR=dev --dart-define=API_BASE_URL=http://<computer-lan-ip>:3000/v1
For FCM testing, use a real device or a Google Play-enabled Android emulator. A device must obtain an FCM token and successfully call POST /v1/devices before closed/background push can work.

Scripts
npm run dev                 # Start custom Next.js development server
npm run build               # Create production build
npm start                   # Start production server
npm run test                # Run Playwright suite
npm run test:unit           # Run Jest unit tests
npm run test:unit:coverage  # Run Jest with coverage
npm run test:auth           # Authentication tests
npm run test:billing        # Billing tests
npm run test:security       # Security tests
npm run test:api            # API tests
Deployment
Add the environment variables to the Vercel project.
Keep BILL_WRITES_ENABLED=false and COMPLAINT_STATUS_WRITES_ENABLED=false until the sensitive mobile write paths have been approved.
Deploy the Next.js project.
Confirm the /v1/:path* rewrite and Vercel cron jobs.
Set the Flutter staging API URL:
flutter run --dart-define=FLAVOR=staging --dart-define=API_BASE_URL=https://<deployment-domain>/v1
The scheduled jobs configured in vercel.json are:

Visitor escalation: every minute.
Lease expiry: daily at 03:00 UTC.
Recent changes
Unified web and mobile deployment
Folded the standalone mobile backend contract into 49 Next.js handlers under app/api/v1.
Added /v1/* rewrites for local development and Vercel.
Added lib/v1 modules for authentication, validation, models, business rules, storage, FCM, notifications, and API error handling.
Bound V1-prefixed Mongoose models to the existing shared MongoDB collections; no duplicate database was introduced.
Serverless realtime and jobs
Replaced long-lived mobile Socket.IO dependency with notification polling and FCM.
Replaced BullMQ-style background workers with Vercel cron endpoints.
Added safety switches for sensitive billing and complaint-status writes.
Notification integration and diagnostics
Corrected website notice creation to call notifyNoticePosted from the shared V1 notification module.
Added Firebase credential support for both FIREBASE_SA_JSON and split service-account variables.
Added FCM delivery diagnostics and device-registration logging.
Confirmed notification records are created in the correct society.
Confirmed the remaining push blocker is missing mobile device-token registration, not Firebase Admin credentials or notice creation.
Reliability and authentication UX
Added MongoDB connection caching, retry/backoff, and explicit connection timeouts to reduce transient development failures.
Added mobile API rewrites to next.config.js so /v1/* works locally as well as on Vercel.
Hardened the login form against native pre-hydration submission so credentials are not placed in the URL and form state is not lost.
Security notes
Never commit .env*, Firebase private keys, MongoDB credentials, access tokens, or diagnostic output containing secrets.
Do not keep unauthenticated diagnostic routes in production.
Remove temporary local diagnostics such as app/api/diag and notif_diag.mjs before committing or deploying.
Use specific Atlas network-access ranges in production instead of 0.0.0.0/0 where practical.
Keep local Claude/IDE settings out of source control.
Known limitations
Closed/background FCM push is not considered complete until at least one mobile device registers a token in devicetokens and an end-to-end delivery succeeds.
In-memory rate limiting is instance-local; a shared rate-limit store is recommended for strict multi-instance enforcement.
Polling provides serverless-compatible updates but is not equivalent to a persistent socket connection.
Some web and V1 routes remain separate HTTP adapters. They share collections, but additional service-layer extraction can further reduce duplicated business logic.
License
Private project. All rights reserved.