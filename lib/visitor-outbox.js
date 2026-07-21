"use client";
// lib/visitor-outbox.js
// Offline-first queue for visitor entries. When the guard has no network, the
// entry (and a locally-captured, compressed photo) is saved on the device and
// sent automatically the moment connectivity returns. Pure browser APIs, no deps.
const OUTBOX_KEY = "aapli_visitor_outbox_v1";
const FLATS_KEY = "aapli_flat_directory_v1";
const listeners = new Set();
let syncing = false;
function read(key, fallback) {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}
function write(key, value) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {}
}
export function isOnline() {
  return typeof navigator === "undefined" ? true : navigator.onLine !== false;
}
export function getQueued() {
  return read(OUTBOX_KEY, []);
}
function setQueued(list) {
  write(OUTBOX_KEY, list);
  emit();
}
function emit() {
  const list = getQueued();
  listeners.forEach((fn) => {
    try {
      fn(list);
    } catch (e) {}
  });
}
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function queueEntry(entry) {
  const list = getQueued();
  const item = Object.assign(
    {
      clientRef: "off_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
      queuedAt: new Date().toISOString(),
      status: "queued",
      error: "",
    },
    entry,
  );
  list.push(item);
  setQueued(list);
  return item;
}
export function removeEntry(clientRef) {
  setQueued(getQueued().filter((e) => e.clientRef !== clientRef));
}
function patchEntry(clientRef, patch) {
  setQueued(
    getQueued().map((e) =>
      e.clientRef === clientRef ? Object.assign({}, e, patch) : e,
    ),
  );
}
// ---- flat directory cache (so flat lookup keeps working offline) ----
export function cacheFlats(flats) {
  if (!Array.isArray(flats) || !flats.length) return;
  const byId = {};
  for (const f of read(FLATS_KEY, [])) byId[f._id || f.id] = f;
  for (const f of flats) byId[f._id || f.id] = f;
  write(FLATS_KEY, Object.values(byId).slice(-2000));
}
export function searchCachedFlats(q) {
  const query = String(q || "").trim().toLowerCase();
  if (!query) return [];
  return read(FLATS_KEY, [])
    .filter((f) => {
      const hay = [f.flatNo, f.wing, f.ownerName, f.tenantName]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(query);
    })
    .slice(0, 20);
}
// ---- photo capture works fully offline (compress to a small JPEG data URL) ----
export function fileToCompressedDataUrl(file, maxDim, quality) {
  const limit = maxDim || 800;
  const q = quality || 0.7;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read image"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Invalid image"));
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > height && width > limit) {
          height = Math.round((height * limit) / width);
          width = limit;
        } else if (height > limit) {
          width = Math.round((width * limit) / height);
          height = limit;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", q));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
function dataUrlToBlob(dataUrl) {
  const parts = dataUrl.split(",");
  const mime = (parts[0].match(/:(.*?);/) || [])[1] || "image/jpeg";
  const bin = atob(parts[1]);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
async function uploadPhoto(dataUrl) {
  const fd = new FormData();
  fd.append("file", dataUrlToBlob(dataUrl), "visitor.jpg");
  const res = await fetch("/api/visitor/upload-photo", {
    method: "POST",
    credentials: "include",
    body: fd,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !data.url)
    throw new Error((data && data.error) || "Photo upload failed");
  return data.url;
}
async function syncOne(entry) {
  let photoUrl = entry.photoUrl || "";
  if (!photoUrl && entry.photoDataUrl) {
    photoUrl = await uploadPhoto(entry.photoDataUrl);
    patchEntry(entry.clientRef, { photoUrl });
  }
  const res = await fetch("/api/visitor/offline-entry", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: entry.name,
      phone: entry.phone || "",
      photo: photoUrl || "",
      purpose: entry.purpose,
      purposeNote: entry.purposeNote || "",
      note: entry.note || "",
      memberId: entry.memberId || "",
      flatNo: entry.flatNo || "",
      wing: entry.wing || "",
      queuedAt: entry.queuedAt,
      clientRef: entry.clientRef,
    }),
  });
  const data = await res.json().catch(() => null);
  if (res.status === 422) {
    patchEntry(entry.clientRef, {
      status: "needs_flat",
      error: (data && data.error) || "Flat not matched — fix the flat and retry",
    });
    return { ok: false, needsFix: true };
  }
  if (!res.ok) throw new Error((data && data.error) || "Sync failed");
  removeEntry(entry.clientRef);
  return { ok: true };
}
export async function syncOutbox() {
  if (syncing || !isOnline()) return { synced: 0, failed: 0, skipped: true };
  syncing = true;
  let synced = 0;
  let failed = 0;
  try {
    for (const entry of getQueued()) {
      if (entry.status === "needs_flat") {
        failed++;
        continue;
      }
      patchEntry(entry.clientRef, { status: "sending", error: "" });
      try {
        const r = await syncOne(entry);
        if (r.ok) synced++;
        else failed++;
      } catch (e) {
        failed++;
        patchEntry(entry.clientRef, {
          status: "queued",
          error: e.message || "Will retry",
        });
      }
    }
  } finally {
    syncing = false;
  }
  return { synced, failed };
}
let started = false;
export function startAutoSync() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("online", () => syncOutbox());
  setInterval(() => {
    if (isOnline() && getQueued().length) syncOutbox();
  }, 20000);
  if (isOnline() && getQueued().length) syncOutbox();
}
