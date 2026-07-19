/**
 * lib/society-code.js
 *
 * Generates the unique 3-digit code assigned to a society (see
 * models/Society.js societyCode). Societies created before this field
 * existed won't have one - ensureSocietyCode() backfills on demand rather
 * than needing a one-off migration script, so any code path that needs a
 * society's code (new creation or an older society) can call this safely.
 */
import Society from "@/models/Society";

async function generateUniqueSocietyCode() {
  const MAX_ATTEMPTS = 30;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const code = String(Math.floor(100 + Math.random() * 900)); // 100-999
    if (!(await Society.findOne({ societyCode: code }).lean())) return code;
  }
  throw new Error("Could not generate a unique society code after 30 attempts");
}

/**
 * @param {object} society  a Society doc that may or may not have societyCode set
 * @returns {Promise<string>} the society's code, generating + persisting one if missing
 */
export async function ensureSocietyCode(society) {
  if (society.societyCode) return society.societyCode;
  const code = await generateUniqueSocietyCode();
  await Society.updateOne({ _id: society._id }, { $set: { societyCode: code } });
  society.societyCode = code;
  return code;
}

export { generateUniqueSocietyCode };
