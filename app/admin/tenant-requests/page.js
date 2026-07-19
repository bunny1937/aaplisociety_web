"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Card,
  PageHeader,
  Button,
  Badge,
  Spinner,
  Toast,
  EmptyState,
  tokens,
  fmtTime,
} from "@/components/visitor/ui";

async function api(url, opts) {
  const res = await fetch(url, {
    credentials: "include",
    headers: opts && opts.body ? { "Content-Type": "application/json" } : undefined,
    ...opts,
  });
  let data = null;
  try {
    data = await res.json();
  } catch (_) {}
  if (!res.ok) throw new Error((data && data.error) || "Request failed");
  return data;
}

const DOCUMENT_FIELDS = [
  { field: "contract", label: "Lease contract" },
  { field: "signature", label: "Signature" },
  { field: "aadhaar", label: "Aadhaar card" },
  { field: "policeVerification", label: "Police verification" },
];

const S = {
  row: { padding: "14px 0", borderBottom: `1px solid ${tokens.border}` },
  rowHead: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" },
  name: { fontWeight: 700, color: tokens.text },
  meta: { fontSize: 12.5, color: tokens.sub, marginTop: 4 },
  docsRow: { display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" },
  actionsRow: { display: "flex", gap: 8, marginTop: 12 },
  center: { display: "flex", justifyContent: "center", padding: 48 },
};

export default function TenantRequestsPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api("/api/admin/tenant-requests?status=Pending");
      setItems(data.items || []);
    } catch (err) {
      setToast({ type: "error", message: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function viewDocument(requestId, field) {
    try {
      const data = await api(`/api/admin/tenant-requests/${requestId}/documents/${field}`);
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setToast({ type: "error", message: err.message });
    }
  }

  async function approve(requestId) {
    setBusyId(requestId);
    try {
      const data = await api(`/api/admin/tenant-requests/${requestId}/approve`, { method: "POST" });
      setToast({
        type: "success",
        message: `Approved. Username: ${data.username}${data.emailDelivered ? "" : " (email not sent — check email provider config)"}`,
      });
      load();
    } catch (err) {
      setToast({ type: "error", message: err.message });
    } finally {
      setBusyId(null);
    }
  }

  async function reject(requestId) {
    const reason = window.prompt("Reason for rejection (shown to the owner):", "");
    if (reason === null) return; // cancelled
    setBusyId(requestId);
    try {
      await api(`/api/admin/tenant-requests/${requestId}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      setToast({ type: "success", message: "Request rejected" });
      load();
    } catch (err) {
      setToast({ type: "error", message: err.message });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Tenant Requests"
        subtitle="Review documents and approve or reject tenant onboarding requests submitted from the mobile app."
      />

      <Card>
        {loading ? (
          <div style={S.center}>
            <Spinner />
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon="🏠" title="No pending tenant requests" subtitle="New requests submitted from the mobile app will appear here." />
        ) : (
          items.map((item) => (
            <div key={item._id} style={S.row}>
              <div style={S.rowHead}>
                <div>
                  <div style={S.name}>{item.tenantName}</div>
                  <div style={S.meta}>
                    {item.tenantPhone} · {item.tenantEmail} · ₹{item.rentPerMonth}/mo
                    {item.createdAt ? ` · Submitted ${fmtTime(item.createdAt)}` : ""}
                  </div>
                </div>
                <Badge color={tokens.sub}>{item.status}</Badge>
              </div>

              <div style={S.docsRow}>
                {DOCUMENT_FIELDS.map(({ field, label }) => (
                  <Button key={field} variant="ghost" size="sm" onClick={() => viewDocument(item._id, field)}>
                    View {label}
                  </Button>
                ))}
              </div>

              <div style={S.actionsRow}>
                <Button disabled={busyId === item._id} onClick={() => approve(item._id)}>
                  Approve
                </Button>
                <Button variant="ghost" disabled={busyId === item._id} onClick={() => reject(item._id)}>
                  Reject
                </Button>
              </div>
            </div>
          ))
        )}
      </Card>

      {toast ? <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} /> : null}
    </div>
  );
}
