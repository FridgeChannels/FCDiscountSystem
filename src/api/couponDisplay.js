function money(amount, currencyCode) {
  const code = currencyCode?.trim() || 'USD';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(amount);
  } catch {
    return `$${amount}`;
  }
}

function formatShippingDestination(dest) {
  if (!dest?.mode || dest.mode === 'all') return 'All countries';
  if (dest.mode === 'countries') {
    const codes = (dest.countries ?? []).filter(Boolean);
    if (!codes.length) return 'Selected countries';
    const label = codes.join(', ');
    return dest.includeRestOfWorld ? `${label} + rest of world` : label;
  }
  return null;
}

function formatMaximumShippingPrice(max) {
  if (!max?.amount) return null;
  return `Shipping up to ${money(max.amount, max.currencyCode)}`;
}

export function formatCouponHeadline(item) {
  const type = item.couponType ?? item.discountType ?? 'percentage';
  const restrictions = item.restrictions;
  if (type === 'free_shipping') return 'FREE SHIPPING';
  if (type === 'fixed_amount') {
    const amount = item.value > 0 ? item.value : Number(item.num ?? 0);
    return amount > 0 ? `${money(amount, item.currencyCode)} OFF` : 'AMOUNT OFF';
  }
  if (type === 'buy_x_get_y') {
    const buy = restrictions?.buyQuantity ?? 1;
    const get = restrictions?.getQuantity ?? 1;
    const pct = restrictions?.getDiscountPercent ?? 100;
    if (pct >= 100) return `BUY ${buy} GET ${get}`;
    return `BUY ${buy} GET ${get} · ${pct}% OFF`;
  }
  const pct = item.value > 0 ? item.value : Number(item.num ?? 0);
  return pct > 0 ? `${pct}% OFF` : 'DISCOUNT';
}

export function formatCouponConditions(item) {
  const type = item.couponType ?? item.discountType ?? 'percentage';
  const r = item.restrictions;
  const parts = [];

  if (type === 'buy_x_get_y') {
    const buy = r?.buyQuantity ?? 1;
    const get = r?.getQuantity ?? 1;
    const pct = r?.getDiscountPercent ?? 100;
    if (pct >= 100) parts.push(`Buy ${buy}, get ${get} free`);
    else parts.push(`Buy ${buy}, get ${get} at ${pct}% off`);
  } else {
    if (r?.minPurchaseAmount != null && r.minPurchaseAmount > 0) {
      parts.push(`Orders over ${money(r.minPurchaseAmount, item.currencyCode)}`);
    }
    if (r?.minPurchaseQuantity != null && r.minPurchaseQuantity > 0) {
      parts.push(`Buy at least ${r.minPurchaseQuantity} items`);
    }
    if (r?.discountTarget === 'product') parts.push('Selected products');
    else if (r?.discountTarget === 'order') parts.push('Entire order');
    else if (!parts.length && (type === 'percentage' || type === 'fixed_amount')) {
      parts.push('Sitewide');
    }
  }

  if (type === 'free_shipping') {
    const dest = formatShippingDestination(r?.shippingDestination);
    if (dest) parts.push(dest);
    const shipMax = formatMaximumShippingPrice(r?.maximumShippingPrice);
    if (shipMax) parts.push(shipMax);
    if (!parts.length) parts.push('Standard shipping');
  }

  if (!parts.length) return 'No minimum';
  return parts.join(' · ');
}

export const COUPON_TYPE_PALETTE_TIER = {
  percentage: 2,
  fixed_amount: 1,
  free_shipping: 5,
  buy_x_get_y: 3,
};

export function inferCouponType(coupon) {
  const explicit = coupon?.couponType ?? coupon?.discountType;
  if (explicit && explicit !== 'percentage') return explicit;

  const conditions = String(coupon?.conditions ?? '').toLowerCase();
  const headline = String(coupon?.headline ?? coupon?.value ?? '').toLowerCase();
  const discountValue = String(coupon?.discountValue ?? '').toLowerCase();

  if (
    conditions.includes('buy') && conditions.includes('get')
  ) return 'buy_x_get_y';
  if (headline.includes('buy') && headline.includes('get')) return 'buy_x_get_y';
  if (/^b\d+g\d+$/i.test(discountValue)) return 'buy_x_get_y';

  if (
    conditions.includes('all countries')
    || conditions.includes('shipping up to')
    || conditions.includes('standard shipping')
    || conditions.includes('free shipping')
    || conditions.includes('free express')
  ) return 'free_shipping';
  if (headline.includes('free ship')) return 'free_shipping';
  if (discountValue === 'free ship') return 'free_shipping';

  if (
    headline.includes('$')
    || (discountValue.includes('$') && !headline.includes('%'))
  ) return 'fixed_amount';

  if (explicit) return explicit;
  const num = Number(String(coupon?.num ?? '').replace(/[^\d.]/g, ''));
  if (Number.isFinite(num) && num > 0) return 'percentage';
  return 'percentage';
}

export function paletteTierForCouponType(type) {
  return COUPON_TYPE_PALETTE_TIER[type] ?? COUPON_TYPE_PALETTE_TIER.percentage;
}

export function couponPaletteTierFor(coupon) {
  if (Number.isInteger(coupon?.paletteTier)) {
    return Math.max(0, Math.min(5, coupon.paletteTier));
  }
  return paletteTierForCouponType(inferCouponType(coupon));
}

export function couponDisplayMode(coupon) {
  const type = inferCouponType(coupon);
  if (type === 'percentage') return 'percent';
  if (type === 'fixed_amount') return 'amount';
  if (type === 'free_shipping') return 'free-shipping';
  if (type === 'buy_x_get_y') return 'bogo';
  return 'text';
}

export function enrichCouponDisplay(coupon) {
  if (!coupon || typeof coupon !== 'object') return coupon;
  const type = inferCouponType(coupon);
  const fromNum = coupon.num != null ? Number(String(coupon.num).replace(/[^\d.]/g, '')) : NaN;
  const rawValue = coupon.discountValue ?? coupon.value;
  const numericValue = Number.isFinite(fromNum) && fromNum > 0
    ? fromNum
    : typeof rawValue === 'number'
      ? rawValue
      : typeof rawValue === 'string' && /^\d+(\.\d+)?$/.test(rawValue.trim())
        ? Number(rawValue)
        : 0;
  const input = {
    couponType: type,
    discountType: type,
    value: numericValue,
    num: coupon.num,
    currencyCode: coupon.currencyCode,
    restrictions: coupon.restrictions,
    label: coupon.label,
  };
  const headline = coupon.headline ?? formatCouponHeadline(input);
  const conditions = coupon.conditions ?? formatCouponConditions(input);
  const mode = coupon.displayMode ?? couponDisplayMode({ ...coupon, couponType: type });
  return {
    ...coupon,
    couponType: type,
    headline,
    value: headline,
    conditions,
    displayMode: mode,
    paletteTier: coupon.paletteTier ?? paletteTierForCouponType(type),
  };
}

export function couponPercentNum(coupon) {
  const mode = couponDisplayMode(coupon);
  if (mode !== 'percent') return '';
  const fromNum = coupon?.num != null ? String(coupon.num).replace(/[^\d.]/g, '') : '';
  const parsed = Number(fromNum);
  if (fromNum && Number.isFinite(parsed) && parsed > 0) return String(parsed);
  const headline = coupon?.headline ?? coupon?.value ?? '';
  const match = String(headline).match(/(\d+(?:\.\d+)?)\s*%/);
  return match ? match[1] : '';
}
