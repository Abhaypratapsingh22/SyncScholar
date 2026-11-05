/**
 * @file App.jsx
 * @description Root application shell for the SyncScholar Student Workspace.
 * Coordinates Header, Network Status Pill, Curriculum Doubt Tutor, and Assessment views.
 * Integrates Clerk authentication with local offline-first session fallback.
 */

import React, { useState, useEffect } from 'react';
import { useUser, useAuth } from '@clerk/react';
import Header from './components/Header.jsx';
import TutorView from './components/TutorView.jsx';
import AssessmentView from './components/AssessmentView.jsx';
import AuthModal from './components/AuthModal.jsx';
import MasteryModal from './components/MasteryModal.jsx';
import { syncService } from './services/syncService.js';
import { api, getAuthToken, setAuthToken, setClerkTokenGetter } from './services/api.js';
import { getLocalStudentSession, saveLocalStudentSession, clearLocalStudentSession } from './db/offlineDb.js';

const HAS_CLERK_KEY = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

/**
 * Bridge component to synchronize Clerk authentication session with local state.
 * Only rendered when ClerkProvider is active.
 */
function ClerkSessionBridge({ onClerkUser, onSignOut }) {
  const { user, isLoaded, isSignedIn } = useUser();
  const { getToken } = useAuth();

  useEffect(() => {
    if (getToken) {
      setClerkTokenGetter(() => getToken());
    }
  }, [getToken]);

  useEffect(() => {
    if (isLoaded) {
      if (isSignedIn && user) {
        const studentProfile = {
          id: user.id,
          name: user.fullName || user.firstName || user.username || 'Student',
          email: user.primaryEmailAddress?.emailAddress,
          current_grade: 9,
          school_id: 'SCH-MAIN-01',
          roll_number: user.id.slice(-6).toUpperCase(),
          isClerkUser: true,
        };
        onClerkUser(studentProfile);
      }
    }
  }, [isLoaded, isSignedIn, user]);

  return null;
}

export function App({ missingClerkKey = false }) {
  const [currentTab, setCurrentTab] = useState('tutor'); // 'tutor' | 'assessment'
  const [syncState, setSyncState] = useState(syncService.getState());
  const [student, setStudent] = useState(null);
  const [selectedGrade, setSelectedGrade] = useState(9);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [masteryModalOpen, setMasteryModalOpen] = useState(false);

  // Subscribe to background sync and connectivity events
  useEffect(() => {
    const unsubscribe = syncService.subscribe((state) => {
      setSyncState(state);
    });

    const handleMasteryUpdated = async () => {
      try {
        if (getAuthToken()) {
          const profileRes = await api.getStudentProfile();
          const profileObj = profileRes?.profile || profileRes?.data;
          if (profileRes?.success && profileObj) {
            setStudent((prev) => ({
              ...prev,
              ...profileObj,
            }));
          }
        }
      } catch (err) {
        console.warn('Could not refresh student profile after sync:', err);
      }
    };

    window.addEventListener('syncscholar:mastery-updated', handleMasteryUpdated);

    return () => {
      unsubscribe();
      window.removeEventListener('syncscholar:mastery-updated', handleMasteryUpdated);
    };
  }, []);

  // Hydrate session from local storage or Dexie (offline-first fallback)
  useEffect(() => {
    async function hydrateSession() {
      try {
        const saved = await getLocalStudentSession();

        if (saved && saved.profile) {
          setStudent(saved.profile);
          if (saved.profile.current_grade) {
            setSelectedGrade(Number(saved.profile.current_grade));
          }
          return;
        }

        if (!HAS_CLERK_KEY) {
          setStudent(null);
        }
      } catch (err) {
        console.warn('Could not hydrate session:', err);
        setStudent(null);
      }
    }
    hydrateSession();
  }, []);

  const handleTriggerSync = () => {
    syncService.triggerSync();
  };

  const handleClerkUser = (clerkProfile) => {
    setStudent(clerkProfile);
    if (clerkProfile?.current_grade) {
      setSelectedGrade(Number(clerkProfile.current_grade));
    }
    saveLocalStudentSession({ profile: clerkProfile, token: null }).catch(() => {});
  };

  const handleAuthSuccess = (newStudent) => {
    setStudent(newStudent);
    if (newStudent?.current_grade) {
      setSelectedGrade(Number(newStudent.current_grade));
    }
  };

  const handleUpdateGrade = async (newGrade) => {
    const num = Number(newGrade);
    setSelectedGrade(num);

    if (student) {
      setStudent((prev) => {
        if (!prev) return null;
        const updated = { ...prev, current_grade: num };
        saveLocalStudentSession({ profile: updated, token: getAuthToken() }).catch(() => {});
        return updated;
      });

      try {
        await api.updateGrade(num);
      } catch (e) {
        console.warn('Could not update grade on server:', e);
      }
    }
  };

  const handleLogout = async () => {
    setStudent(null);
    setAuthToken(null);
    await clearLocalStudentSession();
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      {/* Clerk session bridge (active when ClerkProvider is configured) */}
      {HAS_CLERK_KEY && (
        <ClerkSessionBridge onClerkUser={handleClerkUser} onSignOut={handleLogout} />
      )}

      {/* Missing Clerk Key Notice for Developer / Setup */}
      {(!HAS_CLERK_KEY || missingClerkKey) && (
        <div className="bg-amber-500 text-slate-900 px-4 py-2 text-xs font-semibold text-center flex items-center justify-center gap-2">
          <span>Clerk Setup: Add your <code className="bg-amber-400 px-1 py-0.5 rounded">VITE_CLERK_PUBLISHABLE_KEY</code> to <code className="bg-amber-400 px-1 py-0.5 rounded">client/.env</code> to activate online authentication.</span>
        </div>
      )}

      {/* Persistent Top Header with Network & Sync Status Pill */}
      <Header
        student={student}
        selectedGrade={selectedGrade}
        syncState={syncState}
        onTriggerSync={handleTriggerSync}
        onOpenAuth={() => setAuthModalOpen(true)}
        onOpenMastery={() => setMasteryModalOpen(true)}
        onUpdateGrade={handleUpdateGrade}
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        hasClerkKey={HAS_CLERK_KEY}
      />

      {/* Main Workspace Body */}
      <main className="flex-1 pb-16">
        {currentTab === 'tutor' && (
          <TutorView
            student={student}
            selectedGrade={selectedGrade}
            syncState={syncState}
            onSelectTab={setCurrentTab}
            onUpdateGrade={handleUpdateGrade}
          />
        )}

        {currentTab === 'assessment' && (
          <AssessmentView
            student={student}
            selectedGrade={selectedGrade}
            syncState={syncState}
            onUpdateGrade={handleUpdateGrade}
          />
        )}
      </main>

      {/* Modals */}
      {authModalOpen && (
        <AuthModal
          currentStudent={student}
          onAuthSuccess={handleAuthSuccess}
          onLogout={handleLogout}
          onClose={() => setAuthModalOpen(false)}
        />
      )}

      {masteryModalOpen && (
        <MasteryModal
          student={student}
          onClose={() => setMasteryModalOpen(false)}
        />
      )}

      {/* Low-Bandwidth Classroom Footer */}
      <footer className="py-4 border-t border-slate-200 bg-white text-center text-xs text-slate-700">
        <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>SyncScholar EdTech • Supporting SDG 4 (Quality Education)</span>
          <span>Curriculum Grounded: NCERT & OpenStax • Offline-First PWA</span>
        </div>
      </footer>
    </div>
  );
}

export default App;
