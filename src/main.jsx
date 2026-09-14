import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ExperienceRoot from './ExperienceRoot.jsx';
import ExperienceLoadingPreview from './dev/ExperienceLoadingPreview.jsx';

const isLoadingPreview = import.meta.env.DEV
  && new URLSearchParams(window.location.search).get('debug') === 'loading';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isLoadingPreview ? <ExperienceLoadingPreview /> : <ExperienceRoot />}
  </StrictMode>
);
