import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ExperienceRoot from './ExperienceRoot.jsx';
import ExperienceLoadingPreview from './dev/ExperienceLoadingPreview.jsx';
import ProductStudio from './productStudio/ProductStudio.jsx';
import { initInvestorEmbedAnalytics } from './lib/investorEmbed.js';

initInvestorEmbedAnalytics();

const isLoadingPreview = import.meta.env.DEV
  && new URLSearchParams(window.location.search).get('debug') === 'loading';
const isProductStudio = /^\/product-studio\/?$/.test(window.location.pathname);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isProductStudio ? <ProductStudio /> : isLoadingPreview ? <ExperienceLoadingPreview /> : <ExperienceRoot />}
  </StrictMode>
);
