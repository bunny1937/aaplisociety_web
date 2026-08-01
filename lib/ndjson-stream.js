// Minimal NDJSON (newline-delimited JSON) streaming response for long-running
// admin bulk operations (bill generation, payment import) — lets the client
// render live per-row progress instead of staring at a blank screen for
// minutes. `run(emit)` does the actual work, calling `emit(obj)` for each
// progress line; whatever `run` returns/throws becomes the final
// {type:"done",...} / {type:"error",...} line.
export function ndjsonResponse(run) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (obj) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      try {
        const result = await run(emit);
        emit({ type: "done", ...result });
      } catch (error) {
        emit({ type: "error", error: error.message || "Internal server error" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
