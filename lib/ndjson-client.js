// Reads an NDJSON stream produced by lib/ndjson-stream.js. Calls
// onProgress(obj) for every line except the terminal {type:"done"|"error"}
// line, then resolves with the done payload (or throws on an error line /
// non-OK response). Used for live progress on long bulk admin operations.
export async function postNdjson(url, body, onProgress) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      message = data.error || message;
    } catch {}
    throw new Error(message);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalPayload = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIdx;
    while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (!line) continue;
      const obj = JSON.parse(line);
      if (obj.type === "done") {
        finalPayload = obj;
      } else if (obj.type === "error") {
        throw new Error(obj.error || "Operation failed");
      } else if (onProgress) {
        onProgress(obj);
      }
    }
  }
  if (!finalPayload) throw new Error("Stream ended without a result");
  return finalPayload;
}
