/**
 * React Application Entry Point
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import './i18n';
import './styles/globals.css';
import { initializeDefaultTransports } from './lib/api-client';

// One-time migration: clear persisted dark/system theme so light becomes the default.
// Zustand persist's migrate() handles new installs; this handles existing localStorage.
try {
  const raw = localStorage.getItem('clawx-settings');
  if (raw) {
    const parsed = JSON.parse(raw);
    if (parsed?.state?.theme && parsed.state.theme !== 'light') {
      parsed.state.theme = 'light';
      localStorage.setItem('clawx-settings', JSON.stringify(parsed));
    }
  }
} catch {
  // ignore
}

initializeDefaultTransports();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);
