// Applies an approved ProfileEditRequest's payload onto a live (non-lean)
// Member document. Kept separate from the approve route so the mutation
// logic is unit-testable against a plain mongoose document without a DB
// connection. Mutates `member` in place; caller is responsible for save().
export function applyProfileEditPayload(member, editRequest) {
  const { section, action, familyMemberId, payload = {} } = editRequest;
  if (section === "Contact") {
    if (payload.contactNumber) member.contactNumber = payload.contactNumber;
    if (payload.whatsappNumber) member.whatsappNumber = payload.whatsappNumber;
    if (payload.alternateContact) member.alternateContact = payload.alternateContact;
    return;
  }
  if (section === "EmergencyContact") {
    member.emergencyContact = {
      name: payload.name,
      relation: payload.relation,
      phoneNumber: payload.phoneNumber,
      address: payload.address,
    };
    return;
  }
  if (section === "Parking") {
    if (!Array.isArray(member.parkingSlots)) member.parkingSlots = [];
    if (action === "Add") {
      member.parkingSlots.push({
        slotNumber: payload.slotNumber,
        type: payload.type,
        vehicleType: payload.vehicleType,
        // Business rule (see Member schema): Stilt slots aren't billed monthly.
        monthlyBilling: payload.type !== "Stilt",
      });
      return;
    }
    const slot = payload.slotId
      ? member.parkingSlots.id(payload.slotId)
      : member.parkingSlots.find((s) => s.slotNumber === payload.slotNumber);
    if (!slot) {
      const err = new Error("Parking slot not found on Member document");
      err.code = "PARKING_SLOT_NOT_FOUND";
      throw err;
    }
    if (action === "Remove") {
      slot.deleteOne();
      return;
    }
    // Edit — when identified by slotId, `slotNumber` carries the new value;
    // when identified by slotNumber, `newSlotNumber` carries the rename.
    if (payload.newSlotNumber !== undefined) {
      slot.slotNumber = payload.newSlotNumber;
    } else if (payload.slotId && payload.slotNumber !== undefined) {
      slot.slotNumber = payload.slotNumber;
    }
    if (payload.type !== undefined) {
      slot.type = payload.type;
      slot.monthlyBilling = payload.type !== "Stilt";
    }
    if (payload.vehicleType !== undefined) slot.vehicleType = payload.vehicleType;
    return;
  }
  // FamilyMember
  if (action === "Add") {
    member.familyMembers.push({
      name: payload.name,
      relation: payload.relation,
      age: payload.age,
      contactNumber: payload.contactNumber,
      occupation: payload.occupation,
    });
    return;
  }
  const target = member.familyMembers.id(familyMemberId);
  if (!target) {
    const err = new Error("Family member not found on Member document");
    err.code = "FAMILY_MEMBER_NOT_FOUND";
    throw err;
  }
  if (action === "Remove") {
    target.deleteOne();
    return;
  }
  // Edit
  if (payload.name !== undefined) target.name = payload.name;
  if (payload.relation !== undefined) target.relation = payload.relation;
  if (payload.age !== undefined) target.age = payload.age;
  if (payload.contactNumber !== undefined) target.contactNumber = payload.contactNumber;
  if (payload.occupation !== undefined) target.occupation = payload.occupation;
}