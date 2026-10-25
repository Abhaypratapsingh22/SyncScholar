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
import { getLocalStudentSession, saveLocalStudentSession } from './db/indexedDb.js';

// Default classroom benchmark student
const DEFAULT_STUDENT = {
  id: '6addb0b3bea245e772075f2e',
  name: 'Aarav Sharma (High Mastery)',
  roll_number: 'DEMO-G7-HIGH',
  school_id: 'SCH-DEMO-01',
  current_grade: 7,
};

export function App() {
  const [currentTab, setCurrentTab] = useState('tutor'); // 'tutor' | 'assessment'
  const [syncState, setSyncState] = useState(syncService.getState());
  const [student, setStudent] = useState(DEFAULT_STUDENT);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [masteryModalOpen, setMasteryModalOpen] = useState(false);

  // Subscribe to background sync and connectivity events
  useEffect(() => {
    const unsubscribe = syncService.subscribe((state) => {
      setSyncState(state);
    });
    return unsubscribe;
  }, []);

  // Hydrate session or auto-authenticate default benchmark student
  useEffect(() => {
    async function hydrateSession() {
      try {
        const saved = await getLocalStudentSession();
        const token = getAuthToken();

        if (saved && saved.profile && token) {
          setStudent(saved.profile);
          return;
        }

        // Seamless auto-authentication for the default benchmark student
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
        }
      } catch (err) {
        console.warn('Could not auto-login demo student:', err);
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

  const handleLogout = () => {
    setStudent(null);
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
          <TutorView student={student} syncState={syncState} />
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
