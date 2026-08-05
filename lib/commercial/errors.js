// One error type for both the /api (admin, cookie JWT) and /v1 (mobile,
// bearer JWT) commercial surfaces, so behaviour cannot drift between them.
export class CommercialError extends Error {
  constructor(status, message, code) {
    super(typeof message === "string" ? message : "error");
    this.status = status;
    this.code = code || "COMMERCIAL_ERROR";
    this.body = typeof message === "string" ? { error: message } : message;
  }
}

// Cross-society ids and non-existent ids must be indistinguishable.
export function notFound() {
  return new CommercialError(404, "Not found", "NOT_FOUND");
}

export function featureDisabled() {
  return new CommercialError(403, "Commercial features are not enabled for this society", "FEATURE_DISABLED");
}
