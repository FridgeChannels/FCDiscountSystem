const MOCK_NAMES = [
  'Mike', 'Emma', 'Ryan', 'Lily', 'Noah', 'Alex', 'Mia', 'Ethan',
  'Sophia', 'Liam', 'Olivia', 'James', 'Ava', 'Lucas', 'Isabella',
  'Mason', 'Charlotte', 'Logan', 'Amelia', 'Aiden', 'Harper', 'Elijah',
  'Ella', 'Jackson', 'Scarlett', 'Sebastian', 'Grace', 'Mateo', 'Chloe',
  'Owen', 'Zoey', 'Daniel', 'Nora', 'Henry', 'Riley', 'Alexander',
  'Layla', 'Jack', 'Aria', 'Leo', 'Penelope',
];

const FALLBACK_RANK = 48;

function generateMockPlayers(count = 50) {
  const players = [];
  const usedNames = new Set();

  for (let i = 0; i < count; i++) {
    let name;
    if (i < MOCK_NAMES.length && !usedNames.has(MOCK_NAMES[i])) {
      name = MOCK_NAMES[i];
      usedNames.add(name);
    } else {
      const kind = Math.random();
      if (kind < 0.4) {
        name = `Player ${100 + i * 3}`;
      } else if (kind < 0.7) {
        name = `Guest ${50 + i * 2}`;
      } else {
        const idx = Math.floor(Math.random() * MOCK_NAMES.length);
        name = MOCK_NAMES[idx];
      }
    }

    const baseCoins = Math.max(5, Math.floor(500 - i * 9.2 + (Math.random() - 0.5) * 20));
    players.push({
      rank: i + 1,
      name,
      coins: baseCoins,
      isCurrentUser: false,
      isMock: true,
    });
  }

  return players;
}

let cachedPlayers = null;

function getAllMockPlayers() {
  if (!cachedPlayers) {
    cachedPlayers = generateMockPlayers(50);
  }
  return cachedPlayers;
}

/** Offline / dev fallback when API is unavailable. */
export function getLeaderboard(currentUserName = 'You', currentUserCoins = 0) {
  const all = getAllMockPlayers();
  const sorted = [...all].sort((a, b) => b.coins - a.coins);

  let insertRank = sorted.length + 1;
  for (let i = 0; i < sorted.length; i++) {
    if (currentUserCoins >= sorted[i].coins) {
      insertRank = i + 1;
      break;
    }
  }

  const filtered = sorted.filter((p) => !p.isCurrentUser);
  const currentUser = {
    rank: insertRank,
    name: currentUserName,
    coins: currentUserCoins,
    isCurrentUser: true,
  };

  const result = [...filtered];
  result.splice(insertRank - 1, 0, currentUser);
  result.forEach((p, i) => { p.rank = i + 1; });

  return {
    players: result,
    currentUserRank: insertRank,
    currentUserCoins,
    topPlayers: result.slice(0, 3),
    aroundYou: (() => {
      const start = Math.max(0, insertRank - 3);
      const end = Math.min(result.length, insertRank + 2);
      return result.slice(start, end);
    })(),
  };
}

export function normalizeLeaderboardView(data, fallbackName = 'You', fallbackCoins = 0) {
  if (!data || !Array.isArray(data.players) || !data.players.length) {
    return getLeaderboard(fallbackName, fallbackCoins);
  }
  return {
    players: data.players,
    currentUserRank: data.currentUserRank ?? FALLBACK_RANK,
    currentUserCoins: data.currentUserCoins ?? fallbackCoins,
    topPlayers: Array.isArray(data.topPlayers) && data.topPlayers.length
      ? data.topPlayers
      : data.players.slice(0, 3),
    aroundYou: Array.isArray(data.aroundYou) && data.aroundYou.length
      ? data.aroundYou
      : data.players.slice(
        Math.max(0, (data.currentUserRank ?? FALLBACK_RANK) - 3),
        Math.min(data.players.length, (data.currentUserRank ?? FALLBACK_RANK) + 2),
      ),
  };
}

export function computeRankChange(previousRank, nextRank) {
  const prev = Number(previousRank) || FALLBACK_RANK;
  const next = Number(nextRank) || FALLBACK_RANK;
  return prev - next;
}

/** Project today's rank from a leaderboard snapshot + hypothetical game coins. */
export function projectUserRank(players, projectedTodayCoins) {
  const list = Array.isArray(players) && players.length ? players : getAllMockPlayers();
  const others = list.filter((player) => !player.isCurrentUser);
  const coins = Math.max(0, Math.round(Number(projectedTodayCoins) || 0));

  let rank = others.length + 1;
  for (let i = 0; i < others.length; i += 1) {
    if (coins >= others[i].coins) {
      rank = i + 1;
      break;
    }
  }
  return rank;
}

export function refreshMockData() {
  cachedPlayers = null;
}

export { FALLBACK_RANK };
