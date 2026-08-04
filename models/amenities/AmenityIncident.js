import mongoose from "mongoose";
import { INCIDENT_SEVERITIES, INCIDENT_SEVERITY, INCIDENT_STATUSES, INCIDENT_STATUS, SEVERITY_RANK } from "@/lib/amenities/constants";

// amenity_incidents — damage, hazards, rule violations, lost & found.
//
// `type` is a plain string validated against the society's configured list
// (AmenitySetting.incidentTypes) rather than a schema enum, so a society can
// add "Water Leakage" without a deploy.
const AmenityIncidentSchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
    amenityId: { type: mongoose.Schema.Types.ObjectId, ref: "Amenity", required: true, index: true },
    incidentNo: { type: String, index: true },
    incidentType: { type: String, required: true, trim: true, maxlength: 60, index: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, required: true, trim: true, maxlength: 4000 },
    severity: { type: String, enum: INCIDENT_SEVERITIES, default: INCIDENT_SEVERITY.LOW, index: true },
    // Denormalised from `severity` (kept in sync by the pre-validate hook
    // below) so the triage queue can sort "most severe first" with a plain
    // index instead of a $switch on every page load.
    severityRank: { type: Number, default: 1, index: true },
    status: { type: String, enum: INCIDENT_STATUSES, default: INCIDENT_STATUS.OPEN, index: true },

    reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reportedByName: { type: String, default: "" },
    reportedByRole: { type: String, default: "" },
    reportedByMemberId: { type: mongoose.Schema.Types.ObjectId, ref: "Member", default: null },
    occurredAt: { type: Date, default: Date.now },

    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    assignedToName: { type: String, default: "" },
    assignedAt: { type: Date },

    resolutionNotes: { type: String, trim: true, maxlength: 4000 },
    resolvedAt: { type: Date },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    // Deferred features, modelled now so enabling them is additive:
    // photo attachments reuse the existing UploadedFile/R2 pipeline, and
    // escalation mirrors the visitor escalation ladder.
    attachmentKeys: { type: [String], default: [] },
    escalation: {
      level: { type: Number, default: 0 },
      lastEscalatedAt: { type: Date, default: null },
      stopped: { type: Boolean, default: false },
    },

    linkedComplaintId: { type: mongoose.Schema.Types.ObjectId, ref: "Complaint", default: null },
    linkedMaintenanceId: { type: mongoose.Schema.Types.ObjectId, ref: "AmenityMaintenance", default: null },
  },
  { timestamps: true },
);

AmenityIncidentSchema.pre("validate", function setSeverityRank(next) {
  if (this.isModified("severity")) this.severityRank = SEVERITY_RANK[this.severity] || 1;
  next();
});

AmenityIncidentSchema.index({ societyId: 1, status: 1, severity: 1, createdAt: -1 });
AmenityIncidentSchema.index({ amenityId: 1, createdAt: -1 });

export default mongoose.models.AmenityIncident ||
  mongoose.model("AmenityIncident", AmenityIncidentSchema, "amenity_incidents");
