import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ReorderApp from './reorder/ReorderApp.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ReorderApp />
  </StrictMode>
);
