// Pseudonym generator — unique per complaint, not tied globally to member
const ADJECTIVES = [
  "Velvet",
  "Lunar",
  "Silent",
  "Amber",
  "Cobalt",
  "Iron",
  "Silver",
  "Golden",
  "Crimson",
  "Jade",
  "Neon",
  "Rustic",
  "Marble",
  "Shadow",
  "Crystal",
  "Ashen",
  "Blazing",
  "Frosted",
  "Misty",
  "Storm",
];
const NOUNS = [
  "Tiger",
  "Echo",
  "Circuit",
  "Falcon",
  "Phoenix",
  "River",
  "Prism",
  "Ridge",
  "Vortex",
  "Cipher",
  "Ember",
  "Specter",
  "Nexus",
  "Orbit",
  "Pulse",
  "Torch",
  "Haven",
  "Maze",
  "Signal",
  "Drift",
];
export function generateAnonymousName() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const suffix = Math.floor(Math.random() * 90 + 10); // 10-99
  return `${adj}${noun}${suffix}`;
}
// Profanity filter placeholder — replace with `bad-words` npm package in prod
const BANNED_WORDS = ["badword1", "badword2"];
export function hasProfanity(text) {
  const lower = text.toLowerCase();
  return BANNED_WORDS.some((w) => lower.includes(w));
}
// Block links, emails, phone numbers
const BLOCKED_PATTERNS = [
  /https?:\/\//i, // URLs
  /www\./i, // www links
  /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i, // emails
  /(\+91[\-\s]?)?[6-9]\d{9}/, // Indian phone numbers
  /\b\d{10,}\b/, // long digit strings
];
export function hasBlockedContent(text) {
  return BLOCKED_PATTERNS.some((p) => p.test(text));
}
// Rate limit check helper — called server-side before insert
// Returns { allowed: boolean, reason: string | null }
export function checkRateLimitResult(recentComplaints) {
  const now = Date.now();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayCount = recentComplaints.filter(
    (c) => new Date(c.createdAt) >= todayStart,
  ).length;
  if (todayCount >= 2) {
    return {
      allowed: false,
      reason: "You can submit a maximum of 2 complaints per day.",
    };
  }
  if (recentComplaints.length > 0) {
    const last = new Date(recentComplaints[0].createdAt).getTime();
    const diffMinutes = (now - last) / 60000;
    if (diffMinutes < 15) {
      const wait = Math.ceil(15 - diffMinutes);
      return {
        allowed: false,
        reason: `Please wait ${wait} more minute(s) before submitting again.`,
      };
    }
  }
  return { allowed: true, reason: null };
}
