/**
 * @file App.jsx
 * @description Root application shell for the SyncScholar Student Workspace.
 * Coordinates Header, Network Status Pill, Curriculum Doubt Tutor, and Assessment views.
 */

import React, { useState, useEffect } from 'react';
import Header from './components/Header.jsx';
import TutorView from './components/TutorView.jsx';
import AssessmentView from './components/AssessmentView.jsx';
import AuthModal from './components/AuthModal.jsx';
import MasteryModal from './components/MasteryModal.jsx';
import { syncService } from './services/syncService.js';
import { api, getAuthToken } from './services/api.js';
import { getLocalStudentSession, saveLocalStudentSession, clearLocalStudentSession } from './db/offlineDb.js';

export function App() {
  const [currentTab, setCurrentTab] = useState('tutor'); // 'tutor' | 'assessment'
  const [syncState, setSyncState] = useState(syncService.getState());
  const [student, setStudent] = useState(null);
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

  // Hydrate session or auto-authenticate default benchmark student only in DEV
  useEffect(() => {
    async function hydrateSession() {
      try {
        const saved = await getLocalStudentSession();
        const token = getAuthToken();

        if (saved && saved.profile && token) {
          setStudent(saved.profile);
          return;
        }

        // Clear invalid or tokenless saved session
        if (saved && !token) {
          await clearLocalStudentSession();
        }

        // Demo login only enabled when explicit development environment flag is active
        if (import.meta.env.DEV) {
          try {
            const res = await api.login({
              roll_number: 'DEMO-G7-HIGH',
              school_id: 'SCH-DEMO-01',
              password: 'TestStudent@123',
            });

            if (res?.success && res.user) {
              const profile = {
                id: res.user.id || res.user._id,
                name: res.user.name,
                current_grade: res.user.current_grade || 7,
                school_id: res.user.school_id || 'SCH-DEMO-01',
                roll_number: res.user.roll_number || 'DEMO-G7-HIGH',
              };
              setStudent(profile);
              await saveLocalStudentSession({ profile, token: res.token });
              return;
            }
          } catch (demoErr) {
            console.warn('Could not auto-login demo student in DEV mode:', demoErr);
          }
        }

        // Production or unauthenticated reload requires explicit sign-in
        setStudent(null);
        setAuthModalOpen(true);
      } catch (err) {
        console.warn('Could not hydrate session:', err);
        setStudent(null);
        setAuthModalOpen(true);
      }
    }
    hydrateSession();
  }, []);

  const handleTriggerSync = () => {
    syncService.triggerSync();
  };

  const handleAuthSuccess = (newStudent) => {
    setStudent(newStudent);
  };

  const handleLogout = async () => {
    setStudent(null);
    setAuthToken(null);
    await clearLocalStudentSession();
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      {/* Persistent Top Header with Network & Sync Status Pill */}
      <Header
        student={student}
        syncState={syncState}
        onTriggerSync={handleTriggerSync}
        onOpenAuth={() => setAuthModalOpen(true)}
        onOpenMastery={() => setMasteryModalOpen(true)}
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
      />

      {/* Main Workspace Body */}
      <main className="flex-1 pb-16">
        {currentTab === 'tutor' && (
          <TutorView
            student={student}
            syncState={syncState}
            onSelectTab={setCurrentTab}
          />
        )}

        {currentTab === 'assessment' && (
          <AssessmentView student={student} syncState={syncState} />
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
