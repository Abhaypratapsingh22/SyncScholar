/**
 * @file syncService.js
 * @description Background offline synchronization orchestrator for SyncScholar.
 * 
 * Automatically monitors network connectivity via browser events and /api/health pings,
 * syncing queued offline quiz attempts from Dexie.js IndexedDB to the server upon reconnection.
 */

import { api } from './api.js';
import {
  getPendingQuizSubmissions,
  markQuizSubmissionSynced,
  markQuizSubmissionFailed,
  clearSyncedQuizSubmissions,
  getLocalStudentSession,
} from '../db/offlineDb.js';

class SyncService {
  constructor() {
    this.isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    this.isSyncing = false;
    this.pendingCount = 0;
    this.lastSyncTime = null;
    this.listeners = new Set();
    this.heartbeatTimer = null;

    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.handleNetworkChange(true));
      window.addEventListener('offline', () => this.handleNetworkChange(false));

      // Initial count check
      this.refreshPendingCount();

      // Periodic lightweight reachability check
      this.heartbeatTimer = setInterval(() => {
        this.verifyServerReachability();
      }, 25000);
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
        label: this.pendingCount > 0 ? `Offline — ${this.pendingCount} Queued` : 'Offline — Learning from Cache',
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

  async verifyServerReachability() {
    const navOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    if (!navOnline) {
      if (this.isOnline) {
        this.isOnline = false;
        this.notify();
      }
      return false;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);
      const res = await fetch('/api/health', {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const reachable = res.ok;
      if (reachable !== this.isOnline) {
        this.isOnline = reachable;
        this.notify();
        if (reachable) {
          this.triggerSync();
        }
      }
      return reachable;
    } catch {
      if (this.isOnline) {
        this.isOnline = false;
        this.notify();
      }
      return false;
    }
  }

  async handleNetworkChange(isOnline) {
    if (!isOnline) {
      this.isOnline = false;
      await this.refreshPendingCount();
      this.notify();
      return;
    }

    // When browser fires online event, verify real reachability via health check
    const isReachable = await this.verifyServerReachability();
    if (isReachable) {
      await this.refreshPendingCount();
      this.triggerSync();
    }
  }

  async refreshPendingCount() {
    try {
      const pending = await getPendingQuizSubmissions();
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
      const pendingAttempts = await getPendingQuizSubmissions();
      if (!pendingAttempts || pendingAttempts.length === 0) {
        this.pendingCount = 0;
        this.notify();
        return;
      }

      // Identify currently authenticated student from saved session
      const session = await getLocalStudentSession();
      const currentStudentId = session?.profile?.id || session?.profile?._id;
      if (!currentStudentId) {
        // Without an authenticated student ID, leave items queued until login
        await this.refreshPendingCount();
        return;
      }

      // Only build batches from pendingAttempts whose student_id matches currently signed-in student
      const eligibleAttempts = pendingAttempts.filter(
        (att) => att.student_id === currentStudentId || att.payload?.student_id === currentStudentId
      );

      if (eligibleAttempts.length === 0) {
        await this.refreshPendingCount();
        return;
      }

      this.isSyncing = true;
      this.notify();

      // Split eligible attempts into chunks no larger than server limit (50)
      const MAX_BATCH_SIZE = 50;
      let anySynced = false;

      for (let i = 0; i < eligibleAttempts.length; i += MAX_BATCH_SIZE) {
        const chunk = eligibleAttempts.slice(i, i + MAX_BATCH_SIZE);
        const payload = chunk.map((attempt) => ({
          client_attempt_id: attempt.client_attempt_id,
          learning_objective_id: attempt.learning_objective_id,
          subject: attempt.subject,
          grade_level: attempt.grade_level,
          questions: attempt.payload?.questions || [],
          score: attempt.score,
          max_score: attempt.max_score,
          synced_from_offline: true,
        }));

        try {
          const response = await api.syncBatchAttempts(payload);
          if (response?.success) {
            anySynced = true;
            const syncedIds = chunk.map((a) => a.client_attempt_id);
            for (const id of syncedIds) {
              await markQuizSubmissionSynced(id);
            }
            await clearSyncedQuizSubmissions(syncedIds);
          }
        } catch (chunkErr) {
          console.warn('[SyncService] Batch chunk sync error:', chunkErr?.message);
          for (const attempt of chunk) {
            await markQuizSubmissionFailed(attempt.client_attempt_id, chunkErr?.message || 'Sync failed');
          }
        }
      }

      if (anySynced) {
        this.lastSyncTime = new Date();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('syncscholar:mastery-updated', {
              detail: { timestamp: new Date() },
            })
          );
        }
      }
    } catch (error) {
      console.warn('[SyncService] Background sync deferred:', error?.message);
    } finally {
      this.isSyncing = false;
      await this.refreshPendingCount();
    }
  }
}

export const syncService = new SyncService();
export default syncService;
