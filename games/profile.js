/* Shared player profile — persists in localStorage across all games */
const PROFILE_KEY = 'gracermy_player_profile';
const PROFILE_VERSION = 2;

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
    // v2 migration: wipe state from older profiles so every user gets a
    // fresh start with the new daily reward curve and unified systems.
    if (!saved.version || saved.version < PROFILE_VERSION) {
      const fresh = { ...DEFAULTS };
      saveProfile(fresh);
      return fresh;
    }
    // Merge onto defaults so missing fields always have a safe value
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveProfile(profile) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

/* ── DAILY REWARD CURVE ──
   Weekly cycle, capped at day 7 with a bonus.
     Day 1 = 50
     Day 2 = 60
     Day 3 = 70
     Day 4 = 80
     Day 5 = 90
     Day 6 = 100
     Day 7 = 200  (weekly milestone)
     Day 8+ cycles back to 50 but the streak counter keeps growing.
*/
function rewardForDay(streakDay) {
  // streakDay is 1-based and represents position within the current week cycle
  const cycleDay = ((streakDay - 1) % 7) + 1;
  return cycleDay === 7 ? 200 : 40 + cycleDay * 10;
}

/* Build an array of {day, reward, special} for displaying the weekly calendar.
   `currentStreak` is the user's current streak (after today's claim, if any). */
function dailyRewardSchedule(currentStreak) {
  const cycleStart = currentStreak ? currentStreak - ((currentStreak - 1) % 7) : 1;
  const schedule = [];
  for (let i = 0; i < 7; i++) {
    const day = cycleStart + i;
    const cycleDay = i + 1;
    schedule.push({
      day,
      cycleDay,
      reward: cycleDay === 7 ? 200 : 40 + cycleDay * 10,
      special: cycleDay === 7,
      claimed: day < currentStreak || day === currentStreak,
      isToday: day === currentStreak,
    });
  }
  return schedule;
}

/* Returns { awarded, coins, streak, reward, schedule } — call on page load */
function claimDailyReward() {
  const profile = loadProfile();
  const today = _today();
  if (profile.lastVisitDate === today) {
    return {
      awarded: false,
      coins: profile.coins,
      streak: profile.streak,
      schedule: dailyRewardSchedule(profile.streak),
    };
  }

  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const newStreak = profile.lastVisitDate === yesterday ? profile.streak + 1 : 1;
  const reward = rewardForDay(newStreak);

  profile.coins += reward;
  profile.streak = newStreak;
  profile.lastVisitDate = today;
  saveProfile(profile);

  return {
    awarded: true,
    coins: profile.coins,
    streak: newStreak,
    reward,
    schedule: dailyRewardSchedule(newStreak),
  };
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

/* ── SETTINGS (shared toggle storage per game) ──
   Each game stores its own settings under "<game>_settings". Two toggles
   are standard across games: autoDisable (constrain picker to valid
   numbers) and showTimer. Default both ON. */
const SETTINGS_DEFAULTS = { autoDisable: true, showTimer: true };

function loadSettings(game) {
  try {
    const raw = localStorage.getItem(`${game}_settings`);
    if (!raw) return { ...SETTINGS_DEFAULTS };
    return { ...SETTINGS_DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...SETTINGS_DEFAULTS };
  }
}

function saveSettings(game, settings) {
  localStorage.setItem(`${game}_settings`, JSON.stringify(settings));
}

function getSetting(game, key) {
  return loadSettings(game)[key];
}

function setSetting(game, key, value) {
  const s = loadSettings(game);
  s[key] = value;
  saveSettings(game, s);
}
