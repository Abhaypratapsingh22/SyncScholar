/**
 * @file MasteryModal.jsx
 * @description Student Concept Mastery & Learning Analytics modal for SyncScholar.
 * Displays overall mastery percentage, prerequisite remediation flags, and recent quiz attempts.
 */

import React, { useState, useEffect } from 'react';
import { api } from '../services/api.js';
import { Award, CheckCircle, AlertTriangle, Clock, X, Layers, TrendingUp } from 'lucide-react';

export function MasteryModal({ student, onClose }) {
  const [profileData, setProfileData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchMastery() {
      try {
        const res = await api.getStudentProfile();
        if (res?.success && res.profile) {
          setProfileData(res.profile);
        }
      } catch (err) {
        console.warn('Could not fetch student profile from server:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchMastery();
  }, []);

  const summary = profileData?.mastery_summary || {
    total_concepts: 1,
    mastered_count: 0,
    remediation_needed_count: 0,
    progressing_count: 1,
    average_mastery: 0.5,
  };

  const concepts = profileData?.concept_mastery || [
    {
      learning_objective_id: 'SCI-07-HEAT-04',
      subject: 'Science',
      mastery_score: 0.65,
      attempts_count: 2,
      status: 'progressing',
    },
  ];

  const recentActivity = profileData?.recent_activity || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="classroom-card w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 bg-white shadow-xl animate-fadeIn">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center">
              <Award className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Curriculum Concept Mastery</h2>
              <p className="text-xs text-slate-500">
                {student?.name || 'Student'} • Grade {student?.current_grade || 7} • {student?.school_id || 'School'}
              </p>
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

        {/* Aggregate Stats Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 my-5">
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-center">
            <div className="text-xl font-bold text-brand-700">
              {Math.round(summary.average_mastery * 100)}%
            </div>
            <div className="text-[11px] font-medium text-slate-500 uppercase mt-0.5">Average Mastery</div>
          </div>

          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-center">
            <div className="text-xl font-bold text-emerald-800">{summary.mastered_count}</div>
            <div className="text-[11px] font-medium text-emerald-700 uppercase mt-0.5">Mastered</div>
          </div>

          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-center">
            <div className="text-xl font-bold text-amber-800">{summary.remediation_needed_count}</div>
            <div className="text-[11px] font-medium text-amber-700 uppercase mt-0.5">Remediation</div>
          </div>

          <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-center">
            <div className="text-xl font-bold text-blue-800">{summary.progressing_count}</div>
            <div className="text-[11px] font-medium text-blue-700 uppercase mt-0.5">In Progress</div>
          </div>
        </div>

        {/* Concept Mastery List */}
        <div className="mb-6">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-3 flex items-center gap-1.5">
            <TrendingUp className="w-4 h-4 text-brand-600" />
            <span>Tracked Learning Objectives</span>
          </h3>

          <div className="space-y-2.5">
            {concepts.map((item, idx) => {
              const scorePct = Math.round((item.mastery_score || 0) * 100);
              const needsRemediation = item.mastery_score < 0.5;

              return (
                <div key={idx} className="p-3.5 border border-slate-200 rounded-xl bg-white hover:bg-slate-50">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-xs text-slate-900">{item.learning_objective_id}</span>
                      <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-slate-100 text-slate-600 rounded">
                        {item.subject || 'Science'}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {needsRemediation && (
                        <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded text-[10px] font-bold flex items-center gap-1">
                          <Layers className="w-3 h-3" />
                          <span>Foundation Mode</span>
                        </span>
                      )}
                      <span className="text-xs font-bold text-slate-900">{scorePct}%</span>
                    </div>
                  </div>

                  {/* Visual Progress Bar */}
                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        scorePct >= 80 ? 'bg-emerald-500' : scorePct >= 50 ? 'bg-brand-500' : 'bg-amber-500'
                      }`}
                      style={{ width: `${Math.min(100, Math.max(5, scorePct))}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1.5">
                    <span>Attempts: {item.attempts_count || 1}</span>
                    <span>Status: {item.status || (scorePct >= 80 ? 'mastered' : 'progressing')}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent Formative Micro-Quizzes */}
        {recentActivity.length > 0 && (
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-3 flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-slate-500" />
              <span>Recent Formative Attempts</span>
            </h3>

            <div className="space-y-2">
              {recentActivity.map((attempt, idx) => (
                <div
                  key={idx}
                  className="p-2.5 rounded-lg border border-slate-200 bg-slate-50 text-xs flex items-center justify-between"
                >
                  <div>
                    <span className="font-semibold text-slate-800">{attempt.learning_objective_id}</span>
                    <span className="text-slate-400 ml-2">Class {attempt.grade_level || 7}</span>
                  </div>
                  <div className="flex items-center gap-2 font-bold">
                    <span className={attempt.score === attempt.max_score ? 'text-emerald-600' : 'text-slate-700'}>
                      {attempt.score} / {attempt.max_score}
                    </span>
                    {attempt.synced_from_offline && (
                      <span className="text-[10px] text-slate-400 font-normal">(Synced Offline)</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6 pt-4 border-t border-slate-100 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="btn-touch px-4 py-2 bg-slate-900 text-white font-medium rounded-lg text-xs"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default MasteryModal;
