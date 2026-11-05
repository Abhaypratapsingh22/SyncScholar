/**
 * @file main.jsx
 * @description Application bootstrap entry point for SyncScholar Student Workspace.
 * Registers the Workbox PWA Service Worker for offline-first resilience.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { ClerkProvider } from '@clerk/react';
import App from './App.jsx';
import './index.css';
import { registerSW } from 'virtual:pwa-register';

// Clerk publishable key from environment
const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

// Register Service Worker with automatic updates
registerSW({
  immediate: true,
  onNeedRefresh() {
    console.log('[PWA] New content available, reloading...');
  },
  onOfflineReady() {
    console.log('[PWA] SyncScholar is ready to work offline.');
  },
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {PUBLISHABLE_KEY ? (
      <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl="/">
        <App />
      </ClerkProvider>
    ) : (
      <App missingClerkKey={true} />
    )}
  </React.StrictMode>
);
