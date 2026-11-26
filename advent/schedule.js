// Which type of day lands on which date. Shared by the page and by
// scripts/advent-content.js (which assigns the private content to days), so
// both always agree. Works in the browser and in Node.

(function (root) {
  function rng(seed) { // mulberry32
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rand) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // [{ day, type }] for days 1–24.
  function buildSchedule(cfg) {
    const list = [];
    for (const [t, n] of Object.entries(cfg.DAY_TYPES)) for (let i = 0; i < n; i++) list.push(t);
    // Reshuffle until no two neighbouring days share a type (deterministic per SEED).
    let types = shuffle(list, rng(cfg.SEED));
    for (let s = 1; s < 1000 && types.some((t, i) => t === types[i - 1]); s++) {
      types = shuffle(list, rng(cfg.SEED + s * 7919));
    }
    return types.slice(0, 24).map((type, i) => ({ day: i + 1, type }));
  }

  const api = { rng, shuffle, buildSchedule };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AdventSchedule = api;
})(typeof window !== "undefined" ? window : globalThis);
