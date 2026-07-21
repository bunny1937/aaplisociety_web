// Mirrors web's lib/complaintUtils.js generateAnonymousName().
// Ported from mobile-backend src/lib/anonymousName.ts.
const ADJECTIVES = [
  "Velvet", "Lunar", "Silent", "Amber", "Cobalt", "Iron", "Silver", "Golden",
  "Crimson", "Jade", "Neon", "Rustic", "Marble", "Shadow", "Crystal", "Ashen",
  "Blazing", "Frosted", "Misty", "Storm",
];
const NOUNS = [
  "Tiger", "Echo", "Circuit", "Falcon", "Phoenix", "River", "Prism", "Ridge",
  "Vortex", "Cipher", "Ember", "Specter", "Nexus", "Orbit", "Pulse", "Torch",
  "Haven", "Maze", "Signal", "Drift",
];
export function generateAnonymousName() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const suffix = Math.floor(Math.random() * 90 + 10);
  return `${adj}${noun}${suffix}`;
}
