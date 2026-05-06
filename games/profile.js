/* Shared player profile — persists in localStorage across all games */
const PROFILE_KEY = 'gracermy_player_profile';
const PROFILE_VERSION = 1;

const DEFAULTS = {
  version: PROFILE_VERSION,
  coins: 0,
  totalSolved: 0,
  bestTimes: {},   // keyed as "gameName_difficulty", e.g. "sudoku_hard"
  streak: 0,
  lastVisitDate: null,  // "YYYY-MM-DD"
};

function _today() {
  return new Date().toISOString().slice(0, 10);
}

function loadProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return { ...DEFAULTS };
    const saved = JSON.parse(raw);
    // Merge onto defaults so missing fields always have a safe value
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveProfile(profile) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

/* Returns { awarded, coins, isNewStreak } — call on page load */
function claimDailyReward() {
  const profile = loadProfile();
  const today = _today();
  if (profile.lastVisitDate === today) {
    return { awarded: false, coins: profile.coins, streak: profile.streak };
  }

  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const newStreak = profile.lastVisitDate === yesterday ? profile.streak + 1 : 1;
  const reward = 5 + Math.min(newStreak - 1, 5); // 5 base, +1 per streak day up to +5

  profile.coins += reward;
  profile.streak = newStreak;
  profile.lastVisitDate = today;
  saveProfile(profile);

  return { awarded: true, coins: profile.coins, streak: newStreak, reward };
}

function addCoins(amount) {
  const profile = loadProfile();
  profile.coins = Math.max(0, profile.coins + amount);
  saveProfile(profile);
  return profile.coins;
}

function spendCoins(amount) {
  const profile = loadProfile();
  if (profile.coins < amount) return false;
  profile.coins -= amount;
  saveProfile(profile);
  return true;
}

function getCoins() {
  return loadProfile().coins;
}

/* game: string like "sudoku", difficulty: string like "hard", seconds: number */
function submitBestTime(game, difficulty, seconds) {
  const profile = loadProfile();
  const key = `${game}_${difficulty}`;
  const isNew = !profile.bestTimes[key] || seconds < profile.bestTimes[key];
  if (isNew) profile.bestTimes[key] = seconds;
  profile.totalSolved = (profile.totalSolved || 0) + 1;
  saveProfile(profile);
  return isNew;
}

function getBestTime(game, difficulty) {
  const profile = loadProfile();
  return profile.bestTimes[`${game}_${difficulty}`] || null;
}
