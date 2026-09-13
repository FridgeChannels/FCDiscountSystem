import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ExperienceRoot from './ExperienceRoot.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ExperienceRoot />
  </StrictMode>
);
