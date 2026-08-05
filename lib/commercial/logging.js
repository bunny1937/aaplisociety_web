// Structured, PII-safe logging for every commercial endpoint.
// requestId + societyId + memberId + endpoint + duration, nothing else.
import { randomUUID } from "node:crypto";

export function readRequestId(req) {
  const incoming =
    req?.headers?.get?.("x-request-id") || req?.headers?.get?.("x-vercel-id");
  if (typeof incoming === "string" && /^[\w.:-]{8,120}$/.test(incoming)) {
    return incoming;
  }
  return randomUUID();
}

export function logCommercial(fields) {
  // Never log tokens, cookies, bodies, GST/licence documents or emails.
  const line = JSON.stringify({ scope: "commercial", ...fields });
  if (fields.level === "error") console.error(line);
  else if (fields.level === "warn") console.warn(line);
  else console.log(line);
}

// Wraps a route handler with request-id propagation + timing. Compose INSIDE
// withRoute so ApiError handling is unchanged:
//   export const GET = withRoute(withCommercialLogging("op", handler))
export function withCommercialLogging(operation, handler) {
  return async (req, ctx) => {
    const requestId = readRequestId(req);
    const startedAt = Date.now();
    const endpoint = (() => {
      try {
        return new URL(req.url).pathname;
      } catch {
        return operation;
      }
    })();
    try {
      const res = await handler(req, ctx, { requestId });
      try {
        res.headers.set("x-request-id", requestId);
      } catch {
        /* non-mutable response headers — logging still happens */
      }
      logCommercial({
        level: "info",
        requestId,
        operation,
        endpoint,
        method: req.method,
        statusCode: res.status,
        durationMs: Date.now() - startedAt,
        societyId: res.headers?.get?.("x-society-scope") || undefined,
      });
      return res;
    } catch (err) {
      logCommercial({
        level: err?.status && err.status < 500 ? "warn" : "error",
        requestId,
        operation,
        endpoint,
        method: req.method,
        statusCode: err?.status ?? 500,
        durationMs: Date.now() - startedAt,
        errorCode: err?.code || err?.name || "Error",
        message: typeof err?.message === "string" ? err.message.slice(0, 200) : undefined,
      });
      throw err;
    }
  };
}
