import { useState } from 'react';
import {
  AmazonCta,
  BrandWordmark,
  CopyIconButton,
  CouponTerms,
  Icon,
  MarketplaceProductHero,
  VoluntarySurveyCard,
  useCouponCopy,
} from './marketplaceUi.jsx';

/**
 * Live ASIN Plus product shell. Visual parity with the amazon-product preview,
 * but Place order opens the real Amazon PDP via AmazonCta.
 */
export default function AsinMarketplaceProductScreen({ config, coupons, modules, navigate }) {
  const product = config.products.find((item) => item.id === config.currentProductId);
  const coupon = coupons[0];
  const { code, copied, copy } = useCouponCopy(coupon, config.fcId, product.id, {
    live: true,
    feedbackDuration: 2000,
  });
  const [couponTermsOpen, setCouponTermsOpen] = useState(false);
  const primary = config.brand.colors?.primary || '#004d3d';
  const secondary = config.brand.colors?.secondary || config.brand.colors?.accent || '#fff2db';
  const storeHref = config.brand.storeUrl || config.brand.amazonStoreUrl;

  return (
    <main
      className="marketplace-screen marketplace-screen--2p5d marketplace-screen--product"
      data-brand={config.brand.id}
      data-branded="true"
      style={{ '--brand-primary': primary, '--brand-secondary': secondary }}
      aria-label={`${product.name} product page`}
    >
      <section className="marketplace-product marketplace-product--2p5d" aria-label="Product information" tabIndex={0}>
        <header className="marketplace-header">
          <span className="marketplace-brand" aria-label={config.brand.name}>
            <BrandWordmark brand={config.brand} />
          </span>
        </header>
        <MarketplaceProductHero product={product} brand={config.brand} enableAiCutout={false} />
        <div className="marketplace-product-copy marketplace-product-copy--2p5d">
          {storeHref ? (
            <a className="marketplace-store" href={storeHref} target="_blank" rel="noopener noreferrer">
              Visit the {config.brand.name} Store
            </a>
          ) : null}
          <div className="marketplace-info-page">
            <h1>
              {product.name}
              {product.variant ? `, ${product.variant}` : ''}
            </h1>
            {coupon ? (
              <section className="marketplace-coupon marketplace-coupon--compact" aria-label="Available coupon">
                <strong className="marketplace-coupon__benefit">{coupon.benefit}</strong>
                {code ? (
                  <div className="marketplace-coupon__code-row">
                    <span className="marketplace-coupon__code">
                      Code <code>{code}</code>
                    </span>
                    <CopyIconButton copied={copied} onCopy={copy} />
                    <span className="visually-hidden" role="status">
                      {copied ? 'Code copied' : ''}
                    </span>
                  </div>
                ) : null}
                <button
                  className="marketplace-coupon__details-toggle"
                  type="button"
                  aria-expanded={couponTermsOpen}
                  aria-controls={`marketplace-coupon-terms-${coupon.id}`}
                  onClick={() => setCouponTermsOpen((open) => !open)}
                >
                  <span>{couponTermsOpen ? 'Hide usage conditions' : 'Usage conditions'}</span>
                  <Icon name="chevron" size={18} />
                </button>
                <div
                  className="marketplace-coupon__details"
                  id={`marketplace-coupon-terms-${coupon.id}`}
                  hidden={!couponTermsOpen}
                >
                  <CouponTerms coupon={coupon} product={product} detailed />
                </div>
              </section>
            ) : null}
          </div>
          <footer className="marketplace-action">
            <AmazonCta product={product} brand={config.brand}>
              Place order
            </AmazonCta>
            {modules.showVoluntarySurvey ? (
              <VoluntarySurveyCard survey={config.survey} navigate={navigate} marketplace />
            ) : null}
          </footer>
        </div>
      </section>
    </main>
  );
}
