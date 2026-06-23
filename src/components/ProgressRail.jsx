/**
 * Progress Rail — 游戏顶部固定的进度轨道。
 * 展示:当前金币(🪙 N) + ladder 全部折扣档位与剩余距离。
 * 礼包模式下右侧展示大礼包，不再展示单张券档位。
 * 金币增长与路径推进由父级通过 displayCoins/rail 驱动(见 useGameProgress)。
 */
export default function ProgressRail({
  rail,
  displayCoins,
  lastGain,
  tierUnlock,
  giftReward,
  todayRank,
  rankChange,
}) {
  if (!rail) return null;

  const { nodes, isMaxTier } = rail;
  const unlockPercent = tierUnlock?.percent;

  if (giftReward) {
    const threshold = rail.next?.threshold
      ?? nodes[nodes.length - 1]?.threshold
      ?? 0;
    const fillPct = threshold > 0
      ? Math.min(100, (displayCoins / threshold) * 100)
      : (isMaxTier ? 100 : 0);
    const visibleFillPct = fillPct > 0 ? Math.max(fillPct, fillPct >= 100 ? 100 : 2) : 0;
    const left = Math.max(0, threshold - displayCoins);
    const couponCount = giftReward.couponCount ?? 0;
    const isUnlockPulse = tierUnlock != null || (threshold > 0 && left <= 0);

    return (
      <div className="progress-rail progress-rail--gift-pack" aria-label="Gift pack progress">
        <div className="progress-rail-coins" aria-label={`${displayCoins} coins`}>
          <i className="coin-ic progress-rail-coin-icon" aria-hidden="true" />
          <span className="progress-rail-coin-value">{displayCoins}</span>
          {lastGain ? (
            <span className="progress-rail-coin-gain" key={lastGain.id} aria-live="polite">
              +{lastGain.amount}
            </span>
          ) : null}
        </div>

        <div className="progress-rail-pack-track">
          <div className="progress-rail-pack-line" aria-hidden="true">
            <span
              className="progress-rail-pack-fill"
              style={{ width: `${visibleFillPct}%` }}
            />
          </div>
          <span className={`progress-rail-pack-status${isUnlockPulse ? ' is-unlock-pulse' : ''}`}>
            {left > 0 ? `${left} left` : 'Ready!'}
          </span>
        </div>

        <div
          className={`progress-rail-gift${isUnlockPulse ? ' is-unlock-pulse' : ''}`}
          aria-label={`${couponCount} coupon${couponCount === 1 ? '' : 's'} in gift pack`}
        >
          <img src="/rewards/target-gift.png" alt="" aria-hidden="true" />
          {couponCount > 1 ? (
            <span className="progress-rail-gift-badge">{couponCount}</span>
          ) : null}
        </div>

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
          const rawFill = node.segmentFillPct ?? 0;
          const visibleFillPct = rawFill > 0 ? Math.max(rawFill, rawFill >= 100 ? 100 : 1.5) : 0;
          const isUnlockPulse = unlockPercent === node.percent;
          return (
            <li
              className={`progress-rail-node-wrap is-${node.role}${isUnlockPulse ? ' is-unlock-pulse' : ''}`}
              key={`${node.percent}-${node.threshold}-${index}`}
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
