/**
 * @file Header.jsx
 * @description Persistent top header bar for SyncScholar Student Workspace.
 * Features platform branding, the mandatory Network & Sync Status Pill, and student profile switcher.
 */

import React from 'react';
import { NetworkStatusPill } from './NetworkStatusPill.jsx';
import { BookOpen, User, Award, LogIn, ChevronDown } from 'lucide-react';

export function Header({
  student,
  syncState,
  onTriggerSync,
  onOpenAuth,
  onOpenMastery,
  currentTab,
  onSelectTab,
}) {
  return (
    <header className="sticky top-0 z-30 bg-white border-b border-slate-200 shadow-sm">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16 gap-3">
          {/* Logo & Platform Title */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-600 flex items-center justify-center text-white shadow-sm flex-shrink-0">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-900 text-lg tracking-tight">SyncScholar</span>
                <span className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800 rounded">
                  SDG 4
                </span>
              </div>
              <p className="text-xs text-slate-700 hidden sm:block">Curriculum Socratic AI & Formative Practice</p>
            </div>
          </div>

          {/* Network & Sync Status Pill (AGENTS.md & Prompt Mandate) */}
          <div className="flex items-center gap-2">
            <NetworkStatusPill syncState={syncState} onTriggerSync={onTriggerSync} />

            {/* Student Profile & Quick Actions */}
            {student ? (
              <div className="flex items-center gap-2 ml-2">
                <button
                  type="button"
                  onClick={onOpenMastery}
                  className="btn-touch px-2.5 py-1.5 text-xs text-slate-700 hover:text-brand-700 hover:bg-slate-100 rounded-lg border border-slate-200 flex items-center gap-1.5"
                  title="View Concept Mastery"
                >
                  <Award className="w-4 h-4 text-amber-500" />
                  <span className="hidden md:inline font-medium">Mastery</span>
                </button>

                <button
                  type="button"
                  onClick={onOpenAuth}
                  className="btn-touch px-3 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 text-slate-900 rounded-lg flex items-center gap-2 border border-slate-300 font-medium"
                  title="Switch student profile or log out"
                >
                  <User className="w-3.5 h-3.5 text-slate-600" />
                  <span className="max-w-[110px] truncate">{student.name || 'Student'}</span>
                  <span className="px-1.5 py-0.2 bg-white text-brand-700 text-[10px] font-bold rounded border border-slate-200">
                    G{student.current_grade || 7}
                  </span>
                  <ChevronDown className="w-3 h-3 text-slate-500" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={onOpenAuth}
                className="btn-touch px-3.5 py-1.5 text-xs bg-brand-600 hover:bg-brand-700 text-white rounded-lg font-semibold flex items-center gap-1.5 shadow-sm"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Student Login</span>
              </button>
            )}
          </div>
        </div>

        {/* Workspace Navigation Tabs */}
        <div className="flex border-t border-slate-100 pt-1 -mb-px space-x-2 sm:space-x-4 overflow-x-auto">
          <button
            type="button"
            onClick={() => onSelectTab('tutor')}
            className={`btn-touch px-4 py-2.5 text-sm font-semibold border-b-2 transition-all whitespace-nowrap ${
              currentTab === 'tutor'
                ? 'border-brand-600 text-brand-700 bg-brand-50/50'
                : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
            }`}
          >
            Curriculum Doubt Tutor
          </button>

          <button
            type="button"
            onClick={() => onSelectTab('assessment')}
            className={`btn-touch px-4 py-2.5 text-sm font-semibold border-b-2 transition-all whitespace-nowrap ${
              currentTab === 'assessment'
                ? 'border-brand-600 text-brand-700 bg-brand-50/50'
                : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
            }`}
          >
            Practice Quiz & Flashcards
          </button>
        </div>
      </div>
    </header>
  );
}

export default Header;
