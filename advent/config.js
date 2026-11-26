// Advent calendar settings. Edit these freely.
//
// NOTE: this repo is public, so anyone digging through the code can read this
// file. The password is NOT in here: it lives in Supabase (see setup.sql).

window.ADVENT_CONFIG = {
  YEAR: 2026,

  // Your two names, shown everywhere on the page.
  PEOPLE: [
    { id: "a", name: "Grace" },
    { id: "b", name: "Felix" },
  ],

  // Save to the finance app's Supabase project (set up with setup.sql).
  // Set to false to test with everything saved in this browser only.
  USE_SUPABASE: true,

  // Changing this number reshuffles which type of day lands on which date.
  // Only change it before December 1.
  SEED: 1224,

  // How many of each day type (must add up to 24).
  DAY_TYPES: { coupon: 6, question: 6, spinner: 4, memory: 4, challenge: 4 },
};
