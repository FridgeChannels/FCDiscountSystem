/**
 * Progress Rail — 游戏顶部固定的进度轨道。
 * 展示:当前金币(🪙 N) + 全路径折扣(current / next / future)与剩余距离。
 * 金币增长与路径推进由父级通过 displayCoins/rail 驱动(见 useGameProgress)。
 */
export default function ProgressRail({
  rail,
  displayCoins,
  lastGain,
  tierUnlock,
  todayRank,
  rankChange,
}) {
  if (!rail) return null;

  const { nodes, segmentPct, isMaxTier } = rail;
  const unlockPercent = tierUnlock?.percent;

  return (
    <div className="progress-rail" aria-label="Game progress">
      <div className="progress-rail-coins" aria-label={`${displayCoins} coins`}>
        <i className="coin-ic progress-rail-coin-icon" aria-hidden="true" />
        <span className="progress-rail-coin-value">{displayCoins}</span>
        {lastGain ? (
          <span className="progress-rail-coin-gain" key={lastGain.id} aria-live="polite">
            +{lastGain.amount}
          </span>
        ) : null}
      </div>

      <ol className="progress-rail-track" role="list">
        {nodes.map((node, index) => {
          const isLast = index === nodes.length - 1;
          const fillPct = index === 0 ? segmentPct : 0;
          const visibleFillPct = fillPct > 0 ? Math.max(fillPct, 1.5) : 0;
          const isUnlockPulse = unlockPercent === node.percent;
          return (
            <li
              className={`progress-rail-node-wrap is-${node.role}${isUnlockPulse ? ' is-unlock-pulse' : ''}`}
              key={`${node.percent}-${node.role}`}
            >
              <div className="progress-rail-node-row">
                <span className="progress-rail-node" aria-hidden="true" />
                {!isLast ? (
                  <span className="progress-rail-line">
                    <span
                      className="progress-rail-line-fill"
                      style={{ width: `${visibleFillPct}%` }}
                    />
                  </span>
                ) : null}
              </div>
              <div className="progress-rail-node-copy">
                <strong>{node.percent}% OFF</strong>
                <span
                  className="progress-rail-node-status"
                  key={isUnlockPulse ? tierUnlock.id : node.status}
                >
                  {isUnlockPulse ? 'Unlocked!' : node.status}
                </span>
              </div>
            </li>
          );
        })}
      </ol>

      {isMaxTier ? (
        <span className="progress-rail-max" aria-label="Top tier reached">MAX</span>
      ) : null}

      {todayRank != null && (
        <div className="progress-rail-rank" aria-label={`Today rank ${todayRank}`}>
          <span className="progress-rail-rank-icon">🏆</span>
          <span className="progress-rail-rank-value" key={todayRank}>#{todayRank}</span>
          {rankChange ? (
            <span className="progress-rail-rank-up" key={rankChange.id}>
              ↑{rankChange.amount}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}
