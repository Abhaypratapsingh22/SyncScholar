/**
 * @file AuthModal.jsx
 * @description Fast, classroom-optimized student authentication & switcher modal.
 * Includes 1-click verified Demo Students (High Mastery vs Remediation Mode) for instant evaluation.
 */

import React, { useState } from 'react';
import { api, setAuthToken } from '../services/api.js';
import { saveLocalStudentSession } from '../db/indexedDb.js';
import { User, LogIn, Sparkles, X, Shield, Check, Layers, AlertCircle } from 'lucide-react';

const DEMO_STUDENTS = [
  {
    name: 'Aarav Sharma',
    rollNumber: 'DEMO-G7-HIGH',
    schoolId: 'SCH-DEMO-01',
    password: 'TestStudent@123',
    grade: 7,
    tag: 'High Mastery (85%)',
    badgeColor: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    description: 'Direct Grade 7 Socratic hints (remediation inactive)',
  },
  {
    name: 'Priya Patel',
    rollNumber: 'DEMO-G7-LOW',
    schoolId: 'SCH-DEMO-01',
    password: 'TestStudent@123',
    grade: 7,
    tag: 'Needs Remediation (35%)',
    badgeColor: 'bg-amber-100 text-amber-800 border-amber-200',
    description: 'Triggers Prerequisite Foundation Mode (Grade 6 bridge)',
  },
];

export function AuthModal({ currentStudent, onAuthSuccess, onLogout, onClose }) {
  const [activeTab, setActiveTab] = useState('demo'); // 'demo' | 'login' | 'register'
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  // Form states
  const [identifier, setIdentifier] = useState('');
  const [schoolId, setSchoolId] = useState('SCH-DEMO-01');
  const [password, setPassword] = useState('TestStudent@123');

  // Register form states
  const [regName, setRegName] = useState('');
  const [regRoll, setRegRoll] = useState('');
  const [regGrade, setRegGrade] = useState(7);

  const handleDemoSelect = async (demo) => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await api.login({
        roll_number: demo.rollNumber,
        school_id: demo.schoolId,
        password: demo.password,
      });

      if (res?.success && res.user) {
        const studentObj = {
          id: res.user.id || res.user._id,
          name: res.user.name,
          current_grade: res.user.current_grade || demo.grade,
          school_id: res.user.school_id || demo.schoolId,
          roll_number: demo.rollNumber,
        };
        await saveLocalStudentSession({ profile: studentObj, token: res.token });
        onAuthSuccess(studentObj);
        onClose();
      } else {
        throw new Error(res?.message || 'Login failed');
      }
    } catch (err) {
      console.warn('Demo login network fallback:', err);
      // In offline or local mode, construct local profile
      const offlineProfile = {
        id: `offline-${demo.rollNumber}`,
        name: demo.name,
        current_grade: demo.grade,
        school_id: demo.schoolId,
        roll_number: demo.rollNumber,
        isLocalOffline: true,
      };
      await saveLocalStudentSession({ profile: offlineProfile, token: null });
      onAuthSuccess(offlineProfile);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const handleOfflineGuest = async () => {
    const guestStudent = {
      id: 'local-offline-guest',
      name: 'Classroom Offline Guest',
      current_grade: 7,
      school_id: 'SCH-LOCAL-01',
      roll_number: 'LOCAL-GUEST',
      isLocalOffline: true,
    };
    await saveLocalStudentSession({ profile: guestStudent, token: null });
    onAuthSuccess(guestStudent);
    onClose();
  };

  const handleManualLogin = async (e) => {
    e.preventDefault();
    if (!identifier.trim() || !password) return;

    setLoading(true);
    setErrorMessage(null);

    try {
      const res = await api.login({
        identifier: identifier.trim(),
        school_id: schoolId.trim(),
        password,
      });

      if (res?.success && res.user) {
        const studentObj = {
          id: res.user.id || res.user._id,
          name: res.user.name,
          current_grade: res.user.current_grade || 7,
          school_id: res.user.school_id || schoolId,
          roll_number: res.user.roll_number || identifier,
        };
        await saveLocalStudentSession({ profile: studentObj, token: res.token });
        onAuthSuccess(studentObj);
        onClose();
      } else {
        throw new Error(res?.message || 'Invalid credentials');
      }
    } catch (err) {
      setErrorMessage(err.message || 'Login failed. Please check credentials or network.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    if (!regName.trim() || !regRoll.trim() || !password) return;

    setLoading(true);
    setErrorMessage(null);

    try {
      const res = await api.register({
        name: regName.trim(),
        roll_number: regRoll.trim(),
        school_id: schoolId.trim(),
        role: 'student',
        current_grade: parseInt(regGrade, 10),
        password,
      });

      if (res?.success && res.user) {
        const studentObj = {
          id: res.user.id || res.user._id,
          name: res.user.name,
          current_grade: res.user.current_grade || regGrade,
          school_id: res.user.school_id || schoolId,
          roll_number: regRoll.trim(),
        };
        await saveLocalStudentSession({ profile: studentObj, token: res.token });
        onAuthSuccess(studentObj);
        onClose();
      } else {
        throw new Error(res?.message || 'Registration failed');
      }
    } catch (err) {
      setErrorMessage(err.message || 'Registration failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="classroom-card w-full max-w-lg p-6 bg-white shadow-xl animate-fadeIn">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-brand-50 text-brand-700 flex items-center justify-center">
              <User className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Student Profile Switcher</h2>
              <p className="text-xs text-slate-500">Sign in to track your mastery or choose a test profile</p>
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

        {/* Tab switcher */}
        <div className="flex p-1 bg-slate-100 rounded-xl my-4 text-xs font-semibold">
          <button
            type="button"
            onClick={() => {
              setActiveTab('demo');
              setErrorMessage(null);
            }}
            className={`btn-touch flex-1 py-1.5 rounded-lg transition-all ${
              activeTab === 'demo' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600'
            }`}
          >
            Demo Profiles (1-Click)
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('login');
              setErrorMessage(null);
            }}
            className={`btn-touch flex-1 py-1.5 rounded-lg transition-all ${
              activeTab === 'login' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600'
            }`}
          >
            Student Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('register');
              setErrorMessage(null);
            }}
            className={`btn-touch flex-1 py-1.5 rounded-lg transition-all ${
              activeTab === 'register' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600'
            }`}
          >
            Register
          </button>
        </div>

        {/* Error notice */}
        {errorMessage && (
          <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 mt-0.5 flex-shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* TAB 1: 1-CLICK DEMO PROFILES */}
        {activeTab === 'demo' && (
          <div className="space-y-3">
            <p className="text-xs text-slate-700">
              Select a benchmark student profile to test adaptive RAG and foundation mode:
            </p>

            {DEMO_STUDENTS.map((demo, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleDemoSelect(demo)}
                disabled={loading}
                className="btn-touch w-full p-3.5 text-left rounded-xl border border-slate-200 hover:border-brand-500 bg-white hover:bg-brand-50/40 transition-all flex items-start justify-between gap-3 group"
              >
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-sm text-slate-900 group-hover:text-brand-700">
                      {demo.name}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${demo.badgeColor}`}>
                      {demo.tag}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 leading-snug">{demo.description}</p>
                </div>
                <div className="text-xs font-bold text-brand-600 mt-1 flex items-center gap-1">
                  <span>Select</span>
                  <span>→</span>
                </div>
              </button>
            ))}

            <div className="pt-2">
              <button
                type="button"
                onClick={handleOfflineGuest}
                className="btn-touch w-full py-2.5 text-xs text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-300 rounded-xl font-semibold flex items-center justify-center gap-2"
              >
                <span>Continue as Local Offline Student (No Login Required)</span>
              </button>
            </div>
          </div>
        )}

        {/* TAB 2: MANUAL LOGIN */}
        {activeTab === 'login' && (
          <form onSubmit={handleManualLogin} className="space-y-3.5">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Roll Number or Email:
              </label>
              <input
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="e.g. DEMO-G7-HIGH or student@school.edu"
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
                placeholder="e.g. SCH-DEMO-01"
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
              {loading ? 'Authenticating...' : 'Sign In'}
            </button>
          </form>
        )}

        {/* TAB 3: REGISTER */}
        {activeTab === 'register' && (
          <form onSubmit={handleRegister} className="space-y-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Full Name:</label>
              <input
                type="text"
                value={regName}
                onChange={(e) => setRegName(e.target.value)}
                placeholder="Student Name"
                className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-300 rounded-lg text-slate-900"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Roll Number:</label>
                <input
                  type="text"
                  value={regRoll}
                  onChange={(e) => setRegRoll(e.target.value)}
                  placeholder="e.g. ROLL-01"
                  className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-300 rounded-lg text-slate-900"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Grade (1-12):</label>
                <input
                  type="number"
                  min="1"
                  max="12"
                  value={regGrade}
                  onChange={(e) => setRegGrade(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-300 rounded-lg text-slate-900"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">School ID:</label>
              <input
                type="text"
                value={schoolId}
                onChange={(e) => setSchoolId(e.target.value)}
                className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-300 rounded-lg text-slate-900"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Password:</label>
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
              {loading ? 'Creating Account...' : 'Register Student'}
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
