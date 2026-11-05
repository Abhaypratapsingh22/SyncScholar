/**
 * @file AuthModal.jsx
 * @description Authentication modal for SyncScholar.
 * Integrates Clerk authentication for online multi-tenant access while supporting
 * local offline classroom mode for low-resource environments (SDG 4).
 */

import React, { useState } from 'react';
import { SignIn, SignUp, useUser, useClerk } from '@clerk/react';
import { api, setAuthToken } from '../services/api.js';
import { saveLocalStudentSession, rebindPendingQuizSubmissions } from '../db/offlineDb.js';
import { syncService } from '../services/syncService.js';
import { User, LogIn, X, Shield, AlertCircle, WifiOff } from 'lucide-react';

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

export function AuthModal({ currentStudent, onAuthSuccess, onLogout, onClose }) {
  const [authMode, setAuthMode] = useState('sign-in'); // 'sign-in' | 'sign-up' | 'offline' | 'roll'
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  // Roll-number login states
  const [rollNumber, setRollNumber] = useState('');
  const [schoolId, setSchoolId] = useState('SCH-MAIN-01');
  const [password, setPassword] = useState('');

  // Offline guest login
  const handleOfflineGuest = async () => {
    setAuthToken(null);
    const guestStudent = {
      id: 'local-offline-guest',
      name: 'Classroom Offline Student',
      current_grade: 9,
      school_id: 'SCH-LOCAL-01',
      roll_number: 'LOCAL-GUEST',
      isLocalOffline: true,
    };
    await saveLocalStudentSession({ profile: guestStudent, token: null });
    onAuthSuccess(guestStudent);
    onClose();
  };

  // Roll number & School ID direct login fallback
  const handleRollLogin = async (e) => {
    e.preventDefault();
    if (!rollNumber.trim() || !password) return;

    setLoading(true);
    setErrorMessage(null);

    try {
      const res = await api.login({
        roll_number: rollNumber.trim(),
        school_id: schoolId.trim(),
        password,
      });

      if (res?.success && res.user) {
        const studentObj = {
          id: res.user.id || res.user._id,
          name: res.user.name,
          current_grade: res.user.current_grade || 9,
          school_id: res.user.school_id || schoolId,
          roll_number: res.user.roll_number || rollNumber,
        };
        await rebindPendingQuizSubmissions(studentObj.roll_number, studentObj.id);
        await saveLocalStudentSession({ profile: studentObj, token: res.token });
        onAuthSuccess(studentObj);
        onClose();
        syncService.triggerSync();
      } else {
        throw new Error(res?.message || 'Invalid credentials');
      }
    } catch (err) {
      setErrorMessage(err.message || 'Login failed. Please check credentials or network.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
      <div className="classroom-card w-full max-w-lg p-6 bg-white shadow-xl animate-fadeIn my-8">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-brand-50 text-brand-700 flex items-center justify-center">
              <User className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Student & Teacher Authentication</h2>
              <p className="text-xs text-slate-500">Sign in securely via Clerk or use Classroom Offline Mode</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="btn-touch p-2 text-slate-400 hover:text-slate-800 rounded-lg"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Auth Mode Tabs */}
        <div className="flex p-1 bg-slate-100 rounded-xl my-4 text-xs font-semibold">
          <button
            type="button"
            onClick={() => {
              setAuthMode('sign-in');
              setErrorMessage(null);
            }}
            className={`btn-touch flex-1 py-1.5 rounded-lg transition-all ${
              authMode === 'sign-in' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600'
            }`}
          >
            Clerk Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setAuthMode('sign-up');
              setErrorMessage(null);
            }}
            className={`btn-touch flex-1 py-1.5 rounded-lg transition-all ${
              authMode === 'sign-up' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600'
            }`}
          >
            Clerk Sign Up
          </button>
          <button
            type="button"
            onClick={() => {
              setAuthMode('offline');
              setErrorMessage(null);
            }}
            className={`btn-touch flex-1 py-1.5 rounded-lg transition-all ${
              authMode === 'offline' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600'
            }`}
          >
            Offline Mode
          </button>
          <button
            type="button"
            onClick={() => {
              setAuthMode('roll');
              setErrorMessage(null);
            }}
            className={`btn-touch flex-1 py-1.5 rounded-lg transition-all ${
              authMode === 'roll' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600'
            }`}
          >
            Roll ID
          </button>
        </div>

        {errorMessage && (
          <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2.5 text-rose-800 text-xs">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Tab 1: Clerk Sign In */}
        {authMode === 'sign-in' && (
          <div className="flex justify-center py-2">
            {PUBLISHABLE_KEY ? (
              <SignIn
                appearance={{
                  elements: {
                    rootBox: 'w-full',
                    card: 'shadow-none border-0 p-0 w-full',
                  },
                }}
              />
            ) : (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-center space-y-2">
                <Shield className="w-8 h-8 text-amber-600 mx-auto" />
                <h3 className="font-bold text-sm text-slate-800">Clerk Publishable Key Required</h3>
                <p className="text-xs text-slate-600">
                  To complete Clerk sign-in, add <code className="bg-amber-100 px-1 py-0.5 rounded">VITE_CLERK_PUBLISHABLE_KEY</code> to <code className="bg-amber-100 px-1 py-0.5 rounded">client/.env</code>.
                </p>
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleOfflineGuest}
                    className="btn-touch px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-xs font-bold"
                  >
                    Continue in Classroom Mode
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Clerk Sign Up */}
        {authMode === 'sign-up' && (
          <div className="flex justify-center py-2">
            {PUBLISHABLE_KEY ? (
              <SignUp
                appearance={{
                  elements: {
                    rootBox: 'w-full',
                    card: 'shadow-none border-0 p-0 w-full',
                  },
                }}
              />
            ) : (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-center space-y-2">
                <Shield className="w-8 h-8 text-amber-600 mx-auto" />
                <h3 className="font-bold text-sm text-slate-800">Clerk Publishable Key Required</h3>
                <p className="text-xs text-slate-600">
                  Please configure <code className="bg-amber-100 px-1 py-0.5 rounded">VITE_CLERK_PUBLISHABLE_KEY</code> to enable account registration.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Offline Classroom Mode */}
        {authMode === 'offline' && (
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
            <div className="flex items-center gap-2 text-slate-800">
              <WifiOff className="w-5 h-5 text-brand-600" />
              <h3 className="font-bold text-sm">Offline Local Classroom</h3>
            </div>
            <p className="text-xs text-slate-600">
              For low-bandwidth rural classrooms with intermittent or no connectivity. Quizzes and flashcards are cached in IndexedDB and sync automatically when internet returns.
            </p>
            <button
              type="button"
              onClick={handleOfflineGuest}
              className="btn-touch w-full py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-xs shadow-sm flex items-center justify-center gap-2"
            >
              <LogIn className="w-4 h-4" />
              <span>Enter as Offline Student (Class 9)</span>
            </button>
          </div>
        )}

        {/* Tab 4: School Roll Number Direct Login */}
        {authMode === 'roll' && (
          <form onSubmit={handleRollLogin} className="space-y-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Student Roll Number:
              </label>
              <input
                type="text"
                value={rollNumber}
                onChange={(e) => setRollNumber(e.target.value)}
                placeholder="e.g. ROLL-01"
                className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-300 rounded-lg text-slate-900"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                School ID:
              </label>
              <input
                type="text"
                value={schoolId}
                onChange={(e) => setSchoolId(e.target.value)}
                placeholder="e.g. SCH-MAIN-01"
                className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-300 rounded-lg text-slate-900"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Password:
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-300 rounded-lg text-slate-900"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-touch w-full py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-sm shadow-sm"
            >
              {loading ? 'Authenticating...' : 'Sign In with Roll Number'}
            </button>
          </form>
        )}

        {/* Active Student Logout option */}
        {currentStudent && (
          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs text-slate-500">Currently: {currentStudent.name}</span>
            <button
              type="button"
              onClick={() => {
                setAuthToken(null);
                onLogout();
                onClose();
              }}
              className="text-xs text-rose-600 hover:text-rose-800 font-bold px-2 py-1"
            >
              Sign Out
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default AuthModal;
