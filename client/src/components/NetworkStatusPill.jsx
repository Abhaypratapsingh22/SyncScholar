/**
 * @file NetworkStatusPill.jsx
 * @description Persistent connectivity and offline sync pill for SyncScholar header.
 * Displays Online, Offline — Local Mode, or Syncing Pending Attempts states.
 */

import React from 'react';
import { RefreshCw, Wifi, WifiOff, CloudUpload } from 'lucide-react';

export function NetworkStatusPill({ syncState, onTriggerSync }) {
  const { isOnline, isSyncing, pendingCount, statusPill } = syncState;

  return (
    <div className="flex items-center gap-2">
      <div
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium tracking-wide transition-colors ${statusPill.color}`}
        role="status"
        aria-live="polite"
      >
        <span className={`w-2 h-2 rounded-full ${statusPill.dotColor}`} />
        
        {isSyncing ? (
          <span className="flex items-center gap-1.5">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            <span>{statusPill.label}</span>
          </span>
        ) : !isOnline ? (
          <span className="flex items-center gap-1.5">
            <WifiOff className="w-3.5 h-3.5" />
            <span>{statusPill.label}</span>
          </span>
        ) : pendingCount > 0 ? (
          <span className="flex items-center gap-1.5">
            <CloudUpload className="w-3.5 h-3.5" />
            <span>{statusPill.label}</span>
          </span>
        ) : (
          <span className="flex items-center gap-1.5">
            <Wifi className="w-3.5 h-3.5 text-emerald-600" />
            <span>Online</span>
          </span>
        )}
      </div>

      {/* Manual Sync Trigger button when pending items exist and network is online */}
      {isOnline && pendingCount > 0 && !isSyncing && (
        <button
          type="button"
          onClick={onTriggerSync}
          className="btn-touch px-2.5 py-1 text-xs bg-brand-600 hover:bg-brand-700 text-white rounded-full shadow-sm flex items-center gap-1"
          title="Sync pending quiz attempts to cloud"
        >
          <RefreshCw className="w-3 h-3" />
          <span>Sync Now</span>
        </button>
      )}
    </div>
  );
}

export default NetworkStatusPill;
