/**
 * @file useOfflineSync.js
 * @description React hook and background manager for offline-first resilience in SyncScholar.
 * 
 * Features:
 * 1. Dual connectivity detection: navigator.onLine events + periodic /api/health heartbeats.
 * 2. Intercepts quiz submissions offline, computes immediate local scoring feedback,
 *    and queues to Dexie.js `pending_quiz_submissions`.
 * 3. Automatically flushes pending submissions via `POST /api/assessments/sync-batch`
 *    with idempotent `client_attempt_id` UUIDs upon reconnection.
 * 4. Refreshes student concept_mastery state and maintains clean local stores.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../services/api.js';
import {
  getPendingQuizSubmissions,
  queuePendingQuizSubmission,
  markQuizSubmissionSynced,
  markQuizSubmissionFailed,
  clearSyncedQuizSubmissions,
  generateClientAttemptUuid,
  getLocalStudentSession,
} from '../db/offlineDb.js';

// Global singleton state subscribers to keep all components in sync
const subscribers = new Set();
let globalState = {
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  isSyncing: false,
  pendingCount: 0,
  lastSyncTime: null,
};

function broadcastState() {
  subscribers.forEach((callback) => {
    try {
      callback(globalState);
    } catch (err) {
      console.error('[useOfflineSync] Subscriber notification error:', err);
    }
  });
}

/**
 * Computes status pill configuration for consistent UI rendering.
 */
export function getStatusPillConfig(isOnline, isSyncing, pendingCount) {
  if (isSyncing) {
    return {
      label: `Syncing Pending Attempts (${pendingCount})...`,
      state: 'syncing',
      color: 'text-blue-700 bg-blue-50 border-blue-200',
      dotColor: 'bg-blue-600 animate-pulse',
    };
  }
  if (!isOnline) {
    return {
      label: pendingCount > 0 ? `Offline — ${pendingCount} Queued` : 'Offline — Learning from Cache',
      state: 'offline',
      color: 'text-amber-800 bg-amber-50 border-amber-200',
      dotColor: 'bg-amber-600',
    };
  }
  if (pendingCount > 0) {
    return {
      label: `${pendingCount} Pending Sync`,
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

/**
 * Checks backend reachability via lightweight /api/health ping.
 * Uses a 3-second timeout and cache: 'no-store' to bypass intermediate caches.
 *
 * @returns {Promise<boolean>}
 */
export async function pingHealth() {
  if (typeof window === 'undefined') return true;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    const res = await fetch('/api/health', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Custom React hook for offline synchronization.
 *
 * @param {object} options
 * @param {Function} [options.onMasteryRefresh] - Optional callback triggered after successful sync
 * @returns {object} Sync state and operations
 */
export function useOfflineSync(options = {}) {
  const { onMasteryRefresh } = options;
  const [state, setState] = useState(globalState);
  const isSyncingRef = useRef(false);

  // Refresh pending count from Dexie store
  const refreshPendingCount = useCallback(async () => {
    try {
      const pending = await getPendingQuizSubmissions();
      globalState = {
        ...globalState,
        pendingCount: pending.length,
      };
      broadcastState();
      return pending.length;
    } catch (err) {
      console.warn('[useOfflineSync] Error reading pending submissions:', err);
      return 0;
    }
  }, []);

  /**
   * Flushes pending quiz submissions to POST /api/assessments/sync-batch.
   */
  const flushPendingSubmissions = useCallback(async () => {
    if (isSyncingRef.current || !globalState.isOnline) return;

    try {
      const pendingSubmissions = await getPendingQuizSubmissions();
      if (!pendingSubmissions || pendingSubmissions.length === 0) {
        globalState = { ...globalState, pendingCount: 0, isSyncing: false };
        broadcastState();
        return;
      }

      // Identify currently authenticated student from saved session
      const session = await getLocalStudentSession();
      const currentStudentId = session?.profile?.id || session?.profile?._id;
      if (!currentStudentId) {
        // Leave queued until an authenticated student session is hydrated
        return;
      }

      // Filter attempts strictly matching the current student
      const eligibleSubmissions = pendingSubmissions.filter(
        (sub) => sub.student_id === currentStudentId || sub.payload?.student_id === currentStudentId
      );

      if (eligibleSubmissions.length === 0) {
        return;
      }

      isSyncingRef.current = true;
      globalState = { ...globalState, isSyncing: true };
      broadcastState();

      const MAX_BATCH_SIZE = 50;
      let anySynced = false;

      for (let i = 0; i < eligibleSubmissions.length; i += MAX_BATCH_SIZE) {
        const chunk = eligibleSubmissions.slice(i, i + MAX_BATCH_SIZE);
        const batchPayload = chunk.map((sub) => ({
          client_attempt_id: sub.client_attempt_id,
          learning_objective_id: sub.learning_objective_id,
          subject: sub.subject || 'Science',
          grade_level: sub.grade_level || 7,
          questions: sub.payload?.questions || [],
          score: sub.score ?? 0,
          max_score: sub.max_score ?? 3,
          synced_from_offline: true,
        }));

        try {
          const res = await api.syncBatchAttempts(batchPayload);
          if (res?.success) {
            anySynced = true;
            const syncedIds = chunk.map((s) => s.client_attempt_id);
            for (const id of syncedIds) {
              await markQuizSubmissionSynced(id);
            }
            await clearSyncedQuizSubmissions(syncedIds);
          }
        } catch (chunkErr) {
          console.warn('[useOfflineSync] Chunk sync error:', chunkErr?.message);
          for (const item of chunk) {
            await markQuizSubmissionFailed(item.client_attempt_id, chunkErr?.message || 'Sync failed');
          }
        }
      }

      if (anySynced) {
        globalState = {
          ...globalState,
          lastSyncTime: new Date(),
        };

        // Notify app to refresh student concept mastery
        if (typeof onMasteryRefresh === 'function') {
          try {
            await onMasteryRefresh();
          } catch (mErr) {
            console.warn('[useOfflineSync] Mastery refresh callback error:', mErr);
          }
        }

        // Fire global custom event for other components
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('syncscholar:mastery-updated', {
              detail: { timestamp: new Date() },
            })
          );
        }
      }
    } finally {
      isSyncingRef.current = false;
      globalState = { ...globalState, isSyncing: false };
      await refreshPendingCount();
      broadcastState();
    }
  }, [onMasteryRefresh, refreshPendingCount]);

  /**
   * Verified connectivity check combining navigator.onLine and /api/health ping.
   */
  const checkConnectivity = useCallback(async () => {
    const navOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    if (!navOnline) {
      if (globalState.isOnline) {
        globalState = { ...globalState, isOnline: false };
        broadcastState();
      }
      return false;
    }

    const serverReachable = await pingHealth();
    const statusChanged = globalState.isOnline !== serverReachable;
    globalState = { ...globalState, isOnline: serverReachable };
    broadcastState();

    if (serverReachable && (statusChanged || globalState.pendingCount > 0)) {
      flushPendingSubmissions();
    }

    return serverReachable;
  }, [flushPendingSubmissions]);

  // Handle window online/offline events
  useEffect(() => {
    const handleOnline = async () => {
      const isReachable = await checkConnectivity();
      if (isReachable) {
        await flushPendingSubmissions();
      }
    };

    const handleOffline = () => {
      globalState = { ...globalState, isOnline: false };
      broadcastState();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);

      // Subscribe this hook instance to global state changes
      const syncCallback = (newState) => setState({ ...newState });
      subscribers.add(syncCallback);

      // Initial check & pending count hydration
      refreshPendingCount();
      checkConnectivity();

      // Periodic lightweight /api/health reachability probe (every 25 seconds)
      const heartbeatInterval = setInterval(() => {
        checkConnectivity();
      }, 25000);

      return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
        subscribers.delete(syncCallback);
        clearInterval(heartbeatInterval);
      };
    }
  }, [checkConnectivity, flushPendingSubmissions, refreshPendingCount]);

  /**
   * Resilient Quiz Submission Handler.
   * Intercepts submissions, computes immediate local scoring feedback,
   * writes to Dexie IndexedDB with idempotent UUIDs, and attempts live sync if online.
   *
   * @param {object} params
   * @param {object} params.student
   * @param {object} params.topic - { loId, subject, grade_level }
   * @param {Array} params.questions - Quiz questions
   * @param {object} params.userAnswers - { [questionIndex]: optionIndex }
   * @returns {Promise<object>} Feedback payload
   */
  const submitQuizAttempt = useCallback(
    async ({ student, topic, questions, userAnswers }) => {
      if (!questions || questions.length === 0) {
        throw new Error('No quiz questions provided for submission.');
      }

      // Compute immediate local scoring feedback
      let correctCount = 0;
      const formattedQuestions = questions.map((q, idx) => {
        const selected = userAnswers[idx] ?? null;
        const isCorrect = selected === q.correct_index;
        if (isCorrect) correctCount += 1;
        return {
          question: q.question,
          options: q.options,
          correct_index: q.correct_index,
          selected_index: selected,
          is_correct: isCorrect,
          explanation: q.explanation,
          learning_objective_id: q.learning_objective_id || topic.loId,
        };
      });

      const clientAttemptId = generateClientAttemptUuid();
      const submissionRecord = {
        client_attempt_id: clientAttemptId,
        student_id: student?.id || student?._id || 'offline_student',
        learning_objective_id: topic.loId,
        subject: topic.subject || 'Science',
        grade_level: student?.current_grade || topic.grade_level || 7,
        questions: formattedQuestions,
        score: correctCount,
        max_score: questions.length,
      };

      // Always persist to Dexie pending store first to prevent data loss (Mandate)
      await queuePendingQuizSubmission(submissionRecord);
      await refreshPendingCount();

      const localFeedback = {
        client_attempt_id: clientAttemptId,
        score: correctCount,
        max_score: questions.length,
        questions: formattedQuestions,
        learning_objective_id: topic.loId,
      };

      // If online, attempt immediate submission to server
      if (globalState.isOnline) {
        try {
          const directRes = await api.submitQuizAttempt({
            client_attempt_id: clientAttemptId,
            learning_objective_id: topic.loId,
            subject: topic.subject || 'Science',
            grade_level: student?.current_grade || topic.grade_level || 7,
            questions: formattedQuestions,
            synced_from_offline: false,
          });

          // Mark synced and remove from pending queue
          await markQuizSubmissionSynced(clientAttemptId);
          await clearSyncedQuizSubmissions([clientAttemptId]);
          await refreshPendingCount();

          if (typeof onMasteryRefresh === 'function') {
            await onMasteryRefresh();
          }

          return {
            ...localFeedback,
            synced: true,
            status: 'online_submitted',
            serverData: directRes?.data,
          };
        } catch (err) {
          console.warn('[useOfflineSync] Direct submission deferred to background queue:', err?.message);
          return {
            ...localFeedback,
            synced: false,
            status: 'offline_queued',
            message: 'Network drop detected. Attempt saved locally and queued for automatic sync.',
          };
        }
      }

      // Offline path: return immediate feedback with queued status
      return {
        ...localFeedback,
        synced: false,
        status: 'offline_queued',
        message: 'Saved to local offline queue. Your score will sync automatically when back online.',
      };
    },
    [onMasteryRefresh, refreshPendingCount]
  );

  const statusPill = getStatusPillConfig(state.isOnline, state.isSyncing, state.pendingCount);

  return {
    isOnline: state.isOnline,
    isSyncing: state.isSyncing,
    pendingCount: state.pendingCount,
    lastSyncTime: state.lastSyncTime,
    statusPill,
    submitQuizAttempt,
    triggerSync: flushPendingSubmissions,
    refreshPendingCount,
    checkConnectivity,
  };
}

export default useOfflineSync;
