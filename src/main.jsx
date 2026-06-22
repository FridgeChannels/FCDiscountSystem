import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../fc-style.css';
import '../fc-coupons.css';
import '../fc-tiers.css';
import '../fc-leaderboard.css';
import '../fc-coupon-wallet.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
