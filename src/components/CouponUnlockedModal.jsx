/**
 * 优惠券升级弹层 — 当金币跨过新档位门槛时触发。
 * 《游戏进度定义.md》:🎉 New Coupon Unlocked → {percent}% OFF · Unlocked → Continue。
 */
export default function CouponUnlockedModal({ open, percent, onContinue }) {
  if (!open) return null;

  return (
    <div className="coupon-unlocked-overlay" role="dialog" aria-modal="true" aria-label="New coupon unlocked">
      <div className="coupon-unlocked-card">
        <div className="coupon-unlocked-emoji" aria-hidden="true">🎉</div>
        <h3 className="coupon-unlocked-title">New Coupon Unlocked</h3>
        <div className="coupon-unlocked-value">{percent}% OFF</div>
        <p className="coupon-unlocked-sub">Unlocked</p>
        <button type="button" className="coupon-unlocked-btn" onClick={onContinue}>
          Continue
        </button>
      </div>
    </div>
  );
}
