/**
 * lib/bloom-filter.js
 *
 * Minimal in-memory Bloom filter — no false negatives, rare false positives.
 * Used to pre-check candidate usernames during bulk-import without hitting
 * the DB for every candidate: a "definitely not present" result from the
 * filter skips the DB query entirely; a "maybe present" result still needs
 * an exact User.findOne() to confirm (see lib/username-generator.js).
 */

export class BloomFilter {
  constructor(expectedItems = 1000, falsePositiveRate = 0.01) {
    const n = Math.max(expectedItems, 1);
    this.size = Math.max(8, Math.ceil((-n * Math.log(falsePositiveRate)) / Math.log(2) ** 2));
    this.hashCount = Math.max(1, Math.round((this.size / n) * Math.log(2)));
    this.bits = new Uint8Array(Math.ceil(this.size / 8));
  }

  // Two independent base hashes, then k derived hashes via double hashing
  // (Kirsch-Mitzenmacher) - avoids needing k separate hash functions.
  _hashes(str) {
    let h1 = 0;
    let h2 = 0;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 = (Math.imul(h1, 31) + c) >>> 0;
      h2 = (Math.imul(h2, 131) + c) >>> 0;
    }
    const out = [];
    for (let i = 0; i < this.hashCount; i++) {
      out.push((h1 + i * h2) % this.size);
    }
    return out;
  }

  add(str) {
    for (const idx of this._hashes(str)) {
      this.bits[idx >> 3] |= 1 << (idx & 7);
    }
  }

  mightContain(str) {
    for (const idx of this._hashes(str)) {
      if (!(this.bits[idx >> 3] & (1 << (idx & 7)))) return false;
    }
    return true;
  }
}
