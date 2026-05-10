"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import styles from "@/styles/Dashboard.module.css";

export default function MemberProfilePage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});

  const { data, isLoading } = useQuery({
    queryKey: ["my-profile"],
    queryFn: () => apiClient.get("/api/member/profile"),
    onSuccess: (d) => {
      setForm({
        whatsappNumber: d.member?.whatsappNumber || "",
        alternateContact: d.member?.alternateContact || "",
        emailSecondary: d.member?.emailSecondary || "",
      });
    },
  });

  const saveMutation = useMutation({
    mutationFn: (updates) => apiClient.put("/api/member/profile", updates),
    onSuccess: () => {
      queryClient.invalidateQueries(["my-profile"]);
      setEditing(false);
      alert("✅ Profile updated!");
    },
    onError: (e) => alert("Failed: " + e.message),
  });

  if (isLoading)
    return (
      <div style={{ padding: "3rem", textAlign: "center" }}>
        <div className="loading-spinner" style={{ margin: "0 auto" }}></div>
      </div>
    );

  const member = data?.member;
  const society = data?.society;

  if (!member)
    return (
      <div style={{ padding: "2rem", color: "#6B7280" }}>
        Member profile not found.
      </div>
    );

  const InfoRow = ({ label, value, highlight }) =>
    value ? (
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          padding: "10px 0",
          borderBottom: "1px solid #F3F4F6",
          fontSize: "14px",
        }}
      >
        <span style={{ color: "#6B7280", minWidth: "160px" }}>{label}</span>
        <span
          style={{
            fontWeight: highlight ? "700" : "600",
            color: highlight ? "#1E40AF" : "#1F2937",
            textAlign: "right",
          }}
        >
          {value}
        </span>
      </div>
    ) : null;

  const Section = ({ title, icon, children }) => (
    <div className={styles.contentCard} style={{ marginBottom: "1.5rem" }}>
      <div className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>
          {icon} {title}
        </h2>
      </div>
      <div style={{ padding: "0 1.5rem 1.5rem" }}>{children}</div>
    </div>
  );

  return (
    <div>
      <div
        className={styles.pageHeader}
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <div>
          <h1 className={styles.pageTitle}>My Profile</h1>
          <p className={styles.pageSubtitle}>
            {society?.name} — Member Information
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.75rem" }}>
          {editing ? (
            <>
              <button
                className="btn btn-secondary"
                onClick={() => setEditing(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => saveMutation.mutate(form)}
                disabled={saveMutation.isPending}
              >
                {saveMutation.isPending ? "Saving..." : "💾 Save Changes"}
              </button>
            </>
          ) : (
            <button
              className="btn btn-secondary"
              onClick={() => setEditing(true)}
            >
              ✏️ Edit Contact Info
            </button>
          )}
        </div>
      </div>

      {/* Identity Card */}
      <div
        style={{
          background: "linear-gradient(135deg, #1e40af, #3b82f6)",
          color: "white",
          borderRadius: "12px",
          padding: "28px 32px",
          marginBottom: "1.5rem",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "16px",
        }}
      >
        <div>
          <div
            style={{ fontSize: "24px", fontWeight: "700", marginBottom: "6px" }}
          >
            {member.ownerName}
          </div>
          <div style={{ fontSize: "14px", opacity: 0.85 }}>
            {member.membershipNumber} • {member.membershipStatus}
          </div>
          <div style={{ fontSize: "13px", opacity: 0.75, marginTop: "4px" }}>
            {society?.name}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "32px", fontWeight: "700" }}>
            {member.wing}-{member.flatNo}
          </div>
          <div style={{ fontSize: "13px", opacity: 0.85 }}>
            {member.flatType} • {member.carpetAreaSqft} sq ft
          </div>
          <div style={{ fontSize: "12px", opacity: 0.7, marginTop: "4px" }}>
            {member.ownershipType}
          </div>
        </div>
      </div>

      {/* Basic Info */}
      <Section title="Flat Details" icon="🏠">
        <InfoRow
          label="Flat No."
          value={`${member.wing}-${member.flatNo}`}
          highlight
        />
        <InfoRow
          label="Floor"
          value={member.floor !== undefined ? `Floor ${member.floor}` : null}
        />
        <InfoRow label="Flat Type" value={member.flatType} />
        <InfoRow label="Ownership Type" value={member.ownershipType} />
        <InfoRow
          label="Carpet Area"
          value={
            member.carpetAreaSqft ? `${member.carpetAreaSqft} sq ft` : null
          }
        />
        {member.builtUpAreaSqft && (
          <InfoRow
            label="Built-up Area"
            value={`${member.builtUpAreaSqft} sq ft`}
          />
        )}
        {member.possessionDate && (
          <InfoRow
            label="Possession Date"
            value={new Date(member.possessionDate).toLocaleDateString("en-IN")}
          />
        )}
        <InfoRow label="Membership No." value={member.membershipNumber} />
        <InfoRow label="Status" value={member.membershipStatus} />
        <InfoRow
          label="Voting Rights"
          value={member.hasVotingRights ? "Yes" : "No"}
        />
      </Section>

      {/* Contact Info */}
      <Section title="Contact Information" icon="📞">
        <InfoRow label="Primary Contact" value={member.contactNumber} />
        <InfoRow label="Primary Email" value={member.emailPrimary} />
        {editing ? (
          <>
            <div
              style={{ padding: "10px 0", borderBottom: "1px solid #F3F4F6" }}
            >
              <label
                style={{
                  fontSize: "13px",
                  color: "#6B7280",
                  display: "block",
                  marginBottom: "6px",
                }}
              >
                WhatsApp Number
              </label>
              <input
                className="input"
                value={form.whatsappNumber}
                onChange={(e) =>
                  setForm({ ...form, whatsappNumber: e.target.value })
                }
                placeholder="WhatsApp number"
              />
            </div>
            <div
              style={{ padding: "10px 0", borderBottom: "1px solid #F3F4F6" }}
            >
              <label
                style={{
                  fontSize: "13px",
                  color: "#6B7280",
                  display: "block",
                  marginBottom: "6px",
                }}
              >
                Alternate Contact
              </label>
              <input
                className="input"
                value={form.alternateContact}
                onChange={(e) =>
                  setForm({ ...form, alternateContact: e.target.value })
                }
                placeholder="Alternate phone"
              />
            </div>
            <div
              style={{ padding: "10px 0", borderBottom: "1px solid #F3F4F6" }}
            >
              <label
                style={{
                  fontSize: "13px",
                  color: "#6B7280",
                  display: "block",
                  marginBottom: "6px",
                }}
              >
                Secondary Email
              </label>
              <input
                className="input"
                value={form.emailSecondary}
                onChange={(e) =>
                  setForm({ ...form, emailSecondary: e.target.value })
                }
                placeholder="Secondary email"
              />
            </div>
          </>
        ) : (
          <>
            <InfoRow label="WhatsApp" value={member.whatsappNumber} />
            <InfoRow
              label="Alternate Contact"
              value={member.alternateContact}
            />
            <InfoRow label="Secondary Email" value={member.emailSecondary} />
          </>
        )}
      </Section>

      {/* Identity Documents — show only if data exists */}
      {(member.panCard || member.aadhaar) && (
        <Section title="Identity Documents" icon="🪪">
          {member.panCard && (
            <InfoRow label="PAN Card" value={member.panCard} />
          )}
          {member.aadhaar && (
            <InfoRow
              label="Aadhaar"
              value={`XXXX XXXX ${member.aadhaar.slice(-4)}`}
            />
          )}
        </Section>
      )}

      {/* Parking Slots */}
      {member.parkingSlots?.length > 0 && (
        <Section title="Parking Slots" icon="🚗">
          {member.parkingSlots.map((slot, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                gap: "16px",
                padding: "10px 0",
                borderBottom: "1px solid #F3F4F6",
                fontSize: "14px",
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  fontWeight: "600",
                  color: "#1F2937",
                  minWidth: "100px",
                }}
              >
                {slot.slotNumber}
              </span>
              <span
                style={{
                  background: "#DBEAFE",
                  color: "#1E40AF",
                  padding: "2px 10px",
                  borderRadius: "12px",
                  fontSize: "12px",
                }}
              >
                {slot.type}
              </span>
              <span
                style={{
                  background: "#F3F4F6",
                  color: "#374151",
                  padding: "2px 10px",
                  borderRadius: "12px",
                  fontSize: "12px",
                }}
              >
                {slot.vehicleType}
              </span>
            </div>
          ))}
        </Section>
      )}

      {/* Family Members */}
      {member.familyMembers?.length > 0 && (
        <Section title="Family Members" icon="👨‍👩‍👧‍👦">
          {member.familyMembers.map((fm, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "10px 0",
                borderBottom: "1px solid #F3F4F6",
                fontSize: "14px",
                flexWrap: "wrap",
                gap: "8px",
              }}
            >
              <div>
                <span style={{ fontWeight: "600", color: "#1F2937" }}>
                  {fm.name}
                </span>
                {fm.relation && (
                  <span
                    style={{
                      color: "#6B7280",
                      marginLeft: "8px",
                      fontSize: "13px",
                    }}
                  >
                    ({fm.relation})
                  </span>
                )}
              </div>
              <div
                style={{
                  display: "flex",
                  gap: "12px",
                  fontSize: "13px",
                  color: "#6B7280",
                }}
              >
                {fm.age && <span>Age: {fm.age}</span>}
                {fm.occupation && <span>{fm.occupation}</span>}
                {fm.contactNumber && <span>{fm.contactNumber}</span>}
              </div>
            </div>
          ))}
        </Section>
      )}

      {/* Current Tenant */}
      {member.ownershipType === "Rented" && member.currentTenant && (
        <Section title="Current Tenant" icon="🏠">
          <InfoRow label="Tenant Name" value={member.currentTenant.name} />
          <InfoRow label="Contact" value={member.currentTenant.contactNumber} />
          <InfoRow
            label="Start Date"
            value={
              member.currentTenant.startDate
                ? new Date(member.currentTenant.startDate).toLocaleDateString(
                    "en-IN",
                  )
                : null
            }
          />
          <InfoRow
            label="Rent/Month"
            value={
              member.currentTenant.rentPerMonth
                ? `₹${member.currentTenant.rentPerMonth.toLocaleString("en-IN")}`
                : null
            }
          />
          <InfoRow
            label="Deposit"
            value={
              member.currentTenant.depositAmount
                ? `₹${member.currentTenant.depositAmount.toLocaleString("en-IN")}`
                : null
            }
          />
        </Section>
      )}

      {/* Emergency Contact */}
      {member.emergencyContact?.name && (
        <Section title="Emergency Contact" icon="🆘">
          <InfoRow label="Name" value={member.emergencyContact.name} />
          <InfoRow label="Relation" value={member.emergencyContact.relation} />
          <InfoRow label="Phone" value={member.emergencyContact.phoneNumber} />
        </Section>
      )}

      {/* Society Info */}
      <Section title="Society Information" icon="🏢">
        <InfoRow label="Society Name" value={society?.name} />
        <InfoRow label="Address" value={society?.address} />
        <InfoRow
          label="Maintenance Rate"
          value={
            society?.config?.maintenanceRate
              ? `₹${society.config.maintenanceRate}/sq.ft`
              : null
          }
        />
        <InfoRow
          label="Interest Rate"
          value={
            society?.config?.interestRate
              ? `${society.config.interestRate}% p.a.`
              : null
          }
        />
        <InfoRow
          label="Grace Period"
          value={
            society?.config?.gracePeriodDays
              ? `${society.config.gracePeriodDays} days`
              : null
          }
        />
        <InfoRow
          label="Bill Due Day"
          value={
            society?.config?.billDueDay
              ? `${society.config.billDueDay}th of every month`
              : null
          }
        />
      </Section>
    </div>
  );
}
