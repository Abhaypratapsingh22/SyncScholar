/**
 * @file syncService.js
 * @description Background offline synchronization orchestrator for SyncScholar.
 * 
 * Automatically monitors network connectivity and syncs queued offline quiz attempts
 * from Dexie.js IndexedDB to the server when connection returns.
 */

import { api } from './api.js';
import {
  getPendingQuizAttempts,
  markQuizAttemptSynced,
  markQuizAttemptFailed,
} from '../db/indexedDb.js';

class SyncService {
  constructor() {
    this.isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    this.isSyncing = false;
    this.pendingCount = 0;
    this.lastSyncTime = null;
    this.listeners = new Set();

    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.handleNetworkChange(true));
      window.addEventListener('offline', () => this.handleNetworkChange(false));
      // Initial count check
      this.refreshPendingCount();
    }
  }

  /**
   * Subscribe to network and sync status changes.
   *
   * @param {Function} callback
   * @returns {Function} Unsubscribe function
   */
  subscribe(callback) {
    this.listeners.add(callback);
    // Provide current state immediately
    callback(this.getState());
    return () => this.listeners.delete(callback);
  }

  notify() {
    const state = this.getState();
    this.listeners.forEach((listener) => {
      try {
        listener(state);
      } catch (err) {
        console.error('[SyncService] Listener error:', err);
      }
    });
  }

  getState() {
    return {
      isOnline: this.isOnline,
      isSyncing: this.isSyncing,
      pendingCount: this.pendingCount,
      lastSyncTime: this.lastSyncTime,
      statusPill: this.getStatusPill(),
    };
  }

  /**
   * Computes the current Network & Sync Status Pill state as required by AGENTS.md.
   */
  getStatusPill() {
    if (this.isSyncing) {
      return {
        label: `Syncing Pending Attempts (${this.pendingCount})...`,
        state: 'syncing',
        color: 'text-blue-700 bg-blue-50 border-blue-200',
        dotColor: 'bg-blue-600 animate-pulse',
      };
    }
    if (!this.isOnline) {
      return {
        label: this.pendingCount > 0 ? `Offline — ${this.pendingCount} Queued` : 'Offline — Local Mode',
        state: 'offline',
        color: 'text-amber-800 bg-amber-50 border-amber-200',
        dotColor: 'bg-amber-600',
      };
    }
    if (this.pendingCount > 0) {
      return {
        label: `${this.pendingCount} Pending Sync`,
        state: 'pending',
        color: 'text-indigo-700 bg-indigo-50 border-indigo-200',
        dotColor: 'bg-indigo-600',
      };
    }
    return {
      label: 'Online',
      state: 'online',
      color: 'text-emerald-800 bg-emerald-50 border-emerald-200',
      dotColor: 'bg-emerald-600',
    };
  }

  async handleNetworkChange(isOnline) {
    this.isOnline = isOnline;
    await this.refreshPendingCount();
    this.notify();

    if (isOnline) {
      // Automatically attempt background sync when network comes back online
      this.triggerSync();
    }
  }

  async refreshPendingCount() {
    try {
      const pending = await getPendingQuizAttempts();
      this.pendingCount = pending.length;
    } catch {
      this.pendingCount = 0;
    }
    this.notify();
    return this.pendingCount;
  }

  /**
   * Manually or automatically syncs pending IndexedDB attempts with the server.
   */
  async triggerSync() {
    if (this.isSyncing || !this.isOnline) return;

    try {
      const pendingAttempts = await getPendingQuizAttempts();
      if (!pendingAttempts || pendingAttempts.length === 0) {
        this.pendingCount = 0;
        this.notify();
        return;
      }

      this.isSyncing = true;
      this.notify();

      // Format attempts for idempotent server batch endpoint
      const payload = pendingAttempts.map((attempt) => ({
        client_attempt_id: attempt.client_attempt_id,
        learning_objective_id: attempt.learning_objective_id,
        subject: attempt.subject,
        grade_level: attempt.grade_level,
        questions: attempt.questions,
        score: attempt.score,
        max_score: attempt.max_score,
        synced_from_offline: true,
      }));

      const response = await api.syncBatchAttempts(payload);

      if (response?.success) {
        // Mark synced in Dexie
        for (const attempt of pendingAttempts) {
          await markQuizAttemptSynced(attempt.client_attempt_id);
        }
        this.lastSyncTime = new Date();
      }
    } catch (error) {
      console.warn('[SyncService] Background sync deferred:', error?.message);
      // Mark failed with retry notice
      const pending = await getPendingQuizAttempts();
      for (const attempt of pending) {
        await markQuizAttemptFailed(attempt.client_attempt_id, error?.message || 'Sync failed');
      }
    } finally {
      this.isSyncing = false;
      await this.refreshPendingCount();
    }
  }
}

export const syncService = new SyncService();
export default syncService;
