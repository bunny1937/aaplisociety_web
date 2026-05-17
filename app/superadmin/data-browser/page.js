'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

const H = { "x-admin-api-key": process.env.NEXT_PUBLIC_ADMIN_API_KEY || "" };

async function adminGet(url) {
  const res = await fetch(url, { credentials: "include", headers: H });
  if (!res.ok) throw new Error((await res.json()).error || "Request failed");
  return res.json();
}

async function adminPost(url, body) {
  const res = await fetch(url, { method: "POST", credentials: "include", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json()).error || "Request failed");
  return res.json();
}

export default function AdminDataBrowserPage() {
  const [selectedSociety, setSelectedSociety] = useState('');
  const [selectedCollection, setSelectedCollection] = useState('bills');
  const [selectedItems, setSelectedItems] = useState([]);
  const queryClient = useQueryClient();

  const { data: societiesData } = useQuery({
    queryKey: ['admin-societies'],
    queryFn: () => adminGet('/api/admin/societies'),
  });

  const { data: collectionData, isLoading } = useQuery({
    queryKey: ['admin-data', selectedSociety, selectedCollection],
    queryFn: () => adminGet(`/api/admin/data-browser?societyId=${selectedSociety}&collection=${selectedCollection}`),
    enabled: !!selectedSociety && !!selectedCollection,
  });

  const data = collectionData?.data || [];

  const deleteMutation = useMutation({
    mutationFn: (payload) => adminPost('/api/admin/data-browser', payload),
    onSuccess: (response) => {
      alert(`✅ ${response.deletedCount} items deleted. Exported to Archive for 90 days.`);
      setSelectedItems([]);
      queryClient.invalidateQueries(['admin-data']);
    }
  });

  const handleDelete = () => {
    if (selectedItems.length === 0) {
      alert('Please select items to delete');
      return;
    }

    const reason = prompt('Reason for deletion (required):');
    if (!reason || reason.trim() === '') {
      alert('Deletion reason is required');
      return;
    }

    if (!confirm(`⚠️ Delete ${selectedItems.length} items?\n\n✅ They will be:\n- Exported to Archive\n- Kept for 90 days\n- Auto-deleted after that`)) {
      return;
    }

    deleteMutation.mutate({
      action: 'delete',
      societyId: selectedSociety,
      collection: selectedCollection,
      ids: selectedItems,
      reason
    });
  };

  const toggleSelectAll = () => {
    if (selectedItems.length === data.length) {
      setSelectedItems([]);
    } else {
      setSelectedItems(data.map(d => d._id));
    }
  };

  const toggleItem = (id) => {
    if (selectedItems.includes(id)) {
      setSelectedItems(selectedItems.filter(i => i !== id));
    } else {
      setSelectedItems([...selectedItems, id]);
    }
  };

  const statusColors = {
    paid: { background: "#10b98122", color: "#10b981" },
    unpaid: { background: "#ef444422", color: "#ef4444" },
    partial: { background: "#f59e0b22", color: "#f59e0b" },
  };

  return (
    <div style={{ padding: "2rem", maxWidth: 1300, margin: "0 auto", color: "#f0f0f0" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ fontSize: "1.4rem", fontWeight: 700, margin: 0 }}>Data Browser</h1>
          <p style={{ color: "#6b7280", fontSize: "0.85rem", marginTop: 4 }}>View and manage all society data with export-before-delete protection</p>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: "1rem", marginBottom: "1.25rem", flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 180 }}>
          <label style={{ color: "#9ca3af", fontSize: "0.75rem", fontWeight: 600 }}>Society</label>
          <select
            value={selectedSociety}
            onChange={(e) => {
              setSelectedSociety(e.target.value);
              setSelectedItems([]);
            }}
            style={{ padding: "0.6rem 0.75rem", borderRadius: 6, border: "1px solid #374151", background: "#1f2937", color: "#f0f0f0" }}
          >
            <option value="">-- Select Society --</option>
            {societiesData?.societies?.map(s => (
              <option key={s._id} value={s._id}>{s.name}</option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 180 }}>
          <label style={{ color: "#9ca3af", fontSize: "0.75rem", fontWeight: 600 }}>Collection</label>
          <select
            value={selectedCollection}
            onChange={(e) => {
              setSelectedCollection(e.target.value);
              setSelectedItems([]);
            }}
            style={{ padding: "0.6rem 0.75rem", borderRadius: 6, border: "1px solid #374151", background: "#1f2937", color: "#f0f0f0" }}
          >
            <option value="bills">Bills</option>
            <option value="members">Members</option>
            <option value="transactions">Transactions</option>
            <option value="billingheads">Billing Heads</option>
          </select>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 180 }}>
          <label style={{ color: "#9ca3af", fontSize: "0.75rem", fontWeight: 600 }}>&nbsp;</label>
          <button
            onClick={handleDelete}
            disabled={selectedItems.length === 0 || deleteMutation.isPending}
            style={{ padding: "0.6rem 1.25rem", borderRadius: 6, border: "none", background: selectedItems.length > 0 ? "#dc2626" : "#374151", color: "#fff", fontWeight: 700, cursor: selectedItems.length > 0 ? "pointer" : "not-allowed" }}
          >
            {deleteMutation.isPending ? 'Deleting...' : `🗑️ Delete Selected (${selectedItems.length})`}
          </button>
        </div>
      </div>

      {/* Info Box */}
      {selectedSociety && (
        <div style={{ background: "#0a2010", border: "1px solid #065f46", borderRadius: 8, padding: "1rem 1.25rem", marginBottom: "1.25rem", fontSize: "0.82rem", color: "#6ee7b7" }}>
          <h4>🔒 Export-Before-Delete Protection Active</h4>
          <ul>
            <li>✅ All deleted data is automatically exported to Archive collection</li>
            <li>📅 Archived data is retained for 90 days</li>
            <li>♻️ Can be restored within 90 days if needed</li>
            <li>🗑️ Automatically purged after 90 days</li>
          </ul>
        </div>
      )}

      {/* Data Table */}
      {isLoading ? (
        <div style={{ padding: "3rem", textAlign: "center", color: "#6b7280" }}>Loading data...</div>
      ) : selectedSociety && data.length > 0 ? (
        <div style={{ background: "#111827", border: "1px solid #1f2937", borderRadius: 10, overflow: "hidden" }}>
          <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid #1f2937", display: "flex", justifyContent: "space-between", alignItems: "center", color: "#9ca3af", fontSize: "0.85rem" }}>
            <div>
              <strong>{data.length}</strong> records found
            </div>
            <button onClick={toggleSelectAll} style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid #374151", background: "none", color: "#9ca3af", cursor: "pointer", fontSize: "0.8rem" }}>
              {selectedItems.length === data.length ? '☐ Deselect All' : '☑ Select All'}
            </button>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
            <thead>
              <tr style={{ background: "#0f172a" }}>
                <th style={{ padding: "9px 12px", textAlign: "left", color: "#475569", fontWeight: 700, borderBottom: "1px solid #1f2937", width: 50 }}>
                  <input
                    type="checkbox"
                    checked={selectedItems.length === data.length && data.length > 0}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th style={{ padding: "9px 12px", textAlign: "left", color: "#475569", fontWeight: 700, borderBottom: "1px solid #1f2937" }}>ID</th>
                {selectedCollection === 'bills' && (
                  <>
                    <th style={{ padding: "9px 12px", textAlign: "left", color: "#475569", fontWeight: 700, borderBottom: "1px solid #1f2937" }}>Member</th>
                    <th style={{ padding: "9px 12px", textAlign: "left", color: "#475569", fontWeight: 700, borderBottom: "1px solid #1f2937" }}>Period</th>
                    <th style={{ padding: "9px 12px", textAlign: "left", color: "#475569", fontWeight: 700, borderBottom: "1px solid #1f2937" }}>Amount</th>
                    <th style={{ padding: "9px 12px", textAlign: "left", color: "#475569", fontWeight: 700, borderBottom: "1px solid #1f2937" }}>Status</th>
                    <th style={{ padding: "9px 12px", textAlign: "left", color: "#475569", fontWeight: 700, borderBottom: "1px solid #1f2937" }}>Created</th>
                  </>
                )}
                {selectedCollection === 'members' && (
                  <>
                    <th style={{ padding: "9px 12px", textAlign: "left", color: "#475569", fontWeight: 700, borderBottom: "1px solid #1f2937" }}>Name</th>
                    <th style={{ padding: "9px 12px", textAlign: "left", color: "#475569", fontWeight: 700, borderBottom: "1px solid #1f2937" }}>Flat</th>
                    <th style={{ padding: "9px 12px", textAlign: "left", color: "#475569", fontWeight: 700, borderBottom: "1px solid #1f2937" }}>Contact</th>
                    <th style={{ padding: "9px 12px", textAlign: "left", color: "#475569", fontWeight: 700, borderBottom: "1px solid #1f2937" }}>Area</th>
                  </>
                )}
                {selectedCollection === 'transactions' && (
                  <>
                    <th style={{ padding: "9px 12px", textAlign: "left", color: "#475569", fontWeight: 700, borderBottom: "1px solid #1f2937" }}>Member</th>
                    <th style={{ padding: "9px 12px", textAlign: "left", color: "#475569", fontWeight: 700, borderBottom: "1px solid #1f2937" }}>Type</th>
                    <th style={{ padding: "9px 12px", textAlign: "left", color: "#475569", fontWeight: 700, borderBottom: "1px solid #1f2937" }}>Amount</th>
                    <th style={{ padding: "9px 12px", textAlign: "left", color: "#475569", fontWeight: 700, borderBottom: "1px solid #1f2937" }}>Date</th>
                  </>
                )}
                {selectedCollection === 'billingheads' && (
                  <>
                    <th style={{ padding: "9px 12px", textAlign: "left", color: "#475569", fontWeight: 700, borderBottom: "1px solid #1f2937" }}>Name</th>
                    <th style={{ padding: "9px 12px", textAlign: "left", color: "#475569", fontWeight: 700, borderBottom: "1px solid #1f2937" }}>Calculation Type</th>
                    <th style={{ padding: "9px 12px", textAlign: "left", color: "#475569", fontWeight: 700, borderBottom: "1px solid #1f2937" }}>Default Amount</th>
                    <th style={{ padding: "9px 12px", textAlign: "left", color: "#475569", fontWeight: 700, borderBottom: "1px solid #1f2937" }}>Active</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {data.map((item, i) => (
                <tr
                  key={item._id}
                  style={{
                    background: i % 2 === 0 ? "#111827" : "#0f172a",
                    borderBottom: "1px solid #1a2234",
                    ...(selectedItems.includes(item._id) ? { border: "1px solid #3b82f6" } : {}),
                  }}
                >
                  <td style={{ padding: "7px 12px", color: "#cbd5e1" }}>
                    <input
                      type="checkbox"
                      checked={selectedItems.includes(item._id)}
                      onChange={() => toggleItem(item._id)}
                    />
                  </td>
                  <td style={{ padding: "7px 12px", color: "#475569", fontFamily: "monospace", fontSize: "0.72rem", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis" }}>{item._id}</td>

                  {selectedCollection === 'bills' && (
                    <>
                      <td style={{ padding: "7px 12px", color: "#cbd5e1" }}>{item.memberId?.wing}-{item.memberId?.roomNo}</td>
                      <td style={{ padding: "7px 12px", color: "#cbd5e1" }}>{item.billPeriodId}</td>
                      <td style={{ padding: "7px 12px", color: "#cbd5e1" }}>₹{item.totalAmount}</td>
                      <td style={{ padding: "7px 12px", color: "#cbd5e1" }}>
                        <span style={{ padding: "2px 8px", borderRadius: 10, fontSize: "0.75rem", fontWeight: 700, ...statusColors[item.status?.toLowerCase()] }}>
                          {item.status}
                        </span>
                      </td>
                      <td style={{ padding: "7px 12px", color: "#cbd5e1" }}>{new Date(item.createdAt).toLocaleDateString('en-IN')}</td>
                    </>
                  )}

                  {selectedCollection === 'members' && (
                    <>
                      <td style={{ padding: "7px 12px", color: "#cbd5e1" }}>{item.ownerName}</td>
                      <td style={{ padding: "7px 12px", color: "#cbd5e1" }}>{item.wing}-{item.roomNo}</td>
                      <td style={{ padding: "7px 12px", color: "#cbd5e1" }}>{item.contact}</td>
                      <td style={{ padding: "7px 12px", color: "#cbd5e1" }}>{item.areaSqFt} sq ft</td>
                    </>
                  )}

                  {selectedCollection === 'transactions' && (
                    <>
                      <td style={{ padding: "7px 12px", color: "#cbd5e1" }}>{item.memberId?.wing}-{item.memberId?.roomNo}</td>
                      <td style={{ padding: "7px 12px", color: "#cbd5e1" }}>{item.type}</td>
                      <td style={{ padding: "7px 12px", color: "#cbd5e1" }}>₹{item.amount}</td>
                      <td style={{ padding: "7px 12px", color: "#cbd5e1" }}>{new Date(item.date).toLocaleDateString('en-IN')}</td>
                    </>
                  )}

                  {selectedCollection === 'billingheads' && (
                    <>
                      <td style={{ padding: "7px 12px", color: "#cbd5e1" }}>{item.headName}</td>
                      <td style={{ padding: "7px 12px", color: "#cbd5e1" }}>{item.calculationType}</td>
                      <td style={{ padding: "7px 12px", color: "#cbd5e1" }}>₹{item.defaultAmount}</td>
                      <td style={{ padding: "7px 12px", color: "#cbd5e1" }}>{item.isActive ? '✅' : '❌'}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : selectedSociety ? (
        <div style={{ padding: "4rem", textAlign: "center", color: "#374151", border: "2px dashed #1f2937", borderRadius: 10, margin: "1rem 0" }}>
          <p>No data found in this collection</p>
        </div>
      ) : (
        <div style={{ padding: "4rem", textAlign: "center", color: "#374151", border: "2px dashed #1f2937", borderRadius: 10, margin: "1rem 0" }}>
          <p>👆 Select a society to view data</p>
        </div>
      )}
    </div>
  );
}
