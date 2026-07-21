// Shared HTTP helpers for /v1 route handlers. Replaces the Express
// errorHandler middleware: withRoute connects to Mongo, runs the handler, and
// converts thrown ApiError / unexpected errors into JSON responses.
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";

export class ApiError extends Error {
  // message may be a string OR an already-shaped body object (e.g. a zod
  // flatten result under { error: ... }).
  constructor(status, message) {
    super(typeof message === "string" ? message : "error");
    this.status = status;
    this.body = typeof message === "string" ? { error: message } : message;
  }
}

export function json(data, init) {
  return NextResponse.json(data, init);
}

export function noContent() {
  return new NextResponse(null, { status: 204 });
}

// Throw for a failed zod safeParse, preserving the flattened field errors
// the Flutter client's api_error.dart already knows how to read.
export function zodError(parsed) {
  return new ApiError(400, { error: parsed.error.flatten() });
}

// Wraps a route handler: ensures a DB connection, catches ApiError and
// unexpected errors. Handlers receive (req, ctx) exactly like Next.js passes.
export function withRoute(fn) {
  return async (req, ctx) => {
    try {
      await connectDB();
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof ApiError) {
        return NextResponse.json(e.body, { status: e.status });
      }
      console.error("[v1] unhandled error", e);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  };
}
