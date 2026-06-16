const MOCK_NAMES = [
  'Mike', 'Emma', 'Ryan', 'Lily', 'Noah', 'Alex', 'Mia', 'Ethan',
  'Sophia', 'Liam', 'Olivia', 'James', 'Ava', 'Lucas', 'Isabella',
  'Mason', 'Charlotte', 'Logan', 'Amelia', 'Aiden', 'Harper', 'Elijah',
  'Ella', 'Jackson', 'Scarlett', 'Sebastian', 'Grace', 'Mateo', 'Chloe',
  'Owen', 'Zoey', 'Daniel', 'Nora', 'Henry', 'Riley', 'Alexander',
  'Layla', 'Jack', 'Aria', 'Leo', 'Penelope'
];

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
    });
  }

  return players;
}

let cachedPlayers = null;

function getAllPlayers() {
  if (!cachedPlayers) {
    cachedPlayers = generateMockPlayers(50);
  }
  return cachedPlayers;
}

export function getLeaderboard(currentUserName = 'You', currentUserCoins = 0) {
  const all = getAllPlayers();
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
  };
}

export function getTopPlayers(count = 3) {
  const all = getAllPlayers();
  return all.slice(0, count).map((p, i) => ({ ...p, rank: i + 1 }));
}

export function getAroundYou(currentUserName = 'You', currentUserCoins = 0, range = 2) {
  const { players, currentUserRank } = getLeaderboard(currentUserName, currentUserCoins);
  const start = Math.max(0, currentUserRank - 1 - range);
  const end = Math.min(players.length, currentUserRank + range);
  return players.slice(start, end);
}

export function computeRankChange(previousCoins, currentCoins) {
  const prev = getLeaderboard('You', previousCoins);
  const curr = getLeaderboard('You', currentCoins);
  return prev.currentUserRank - curr.currentUserRank;
}

export function refreshMockData() {
  cachedPlayers = null;
}
