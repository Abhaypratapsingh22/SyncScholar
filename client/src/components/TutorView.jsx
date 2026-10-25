/**
 * @file TutorView.jsx
 * @description Curriculum Doubt Tutor View for SyncScholar.
 * 
 * Features:
 * 1. Subject selector & common curriculum topic chips
 * 2. Clean, high-contrast chat thread optimized for classroom screens
 * 3. Socratic guiding hint callout box (first clue & everyday analogy)
 * 4. Prerequisite Foundation Mode badge when bridging earlier grade concepts
 * 5. Expandable NCERT / OpenStax Source Citation Cards with page and external links
 * 6. Low-bandwidth empathy: Dexie.js offline caching, loading skeleton, and error retries
 */

import React, { useState, useEffect, useRef } from 'react';
import { api } from '../services/api.js';
import { cacheTutorThread, getCachedTutorThreads } from '../db/indexedDb.js';
import { EmptyState } from './EmptyState.jsx';
import {
  Send,
  Sparkles,
  BookOpen,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  HelpCircle,
  Layers,
  CheckCircle,
  RotateCcw,
} from 'lucide-react';

const SUGGESTED_QUESTIONS = [
  {
    subject: 'Science',
    loId: 'SCI-07-HEAT-04',
    text: 'Why do metal spoons feel colder than wooden spoons on a winter morning?',
  },
  {
    subject: 'Science',
    loId: 'SCI-07-HEAT-04',
    text: 'How does heat transfer by conduction through solids?',
  },
  {
    subject: 'Science',
    loId: 'SCI-07-NUTR-01',
    text: 'What raw materials do green plants need for photosynthesis?',
  },
];

export function TutorView({ student, syncState }) {
  const [subject, setSubject] = useState('Science');
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState([]);
  const [errorMessage, setErrorMessage] = useState(null);
  const [expandedCitations, setExpandedCitations] = useState({});
  const chatEndRef = useRef(null);

  // Load cached messages from IndexedDB for offline persistence
  useEffect(() => {
    async function loadHistory() {
      try {
        const cached = await getCachedTutorThreads();
        if (cached && cached.length > 0) {
          // Format into message objects
          const initialMessages = [];
          cached.reverse().forEach((item) => {
            initialMessages.push({
              id: `${item.id}-q`,
              role: 'student',
              content: item.question,
              subject: item.subject,
              timestamp: item.created_at,
            });
            initialMessages.push({
              id: `${item.id}-a`,
              role: 'tutor',
              content: item.answer,
              socratic_follow_up: item.socratic_follow_up,
              remediation_mode_active: item.remediation_mode_active,
              citations: item.citations || [],
              timestamp: item.created_at,
            });
          });
          setMessages(initialMessages);
        }
      } catch (err) {
        console.warn('Could not load cached tutor messages:', err);
      }
    }
    loadHistory();
  }, []);

  // Auto-scroll chat to latest response
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const toggleCitation = (msgIndex, citIndex) => {
    const key = `${msgIndex}-${citIndex}`;
    setExpandedCitations((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleAsk = async (queryText = null, loId = null) => {
    const textToAsk = (queryText || question).trim();
    if (!textToAsk || loading) return;

    setErrorMessage(null);
    const studentMsg = {
      id: `msg-${Date.now()}-q`,
      role: 'student',
      content: textToAsk,
      subject,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, studentMsg]);
    if (!queryText) setQuestion('');
    setLoading(true);

    try {
      const response = await api.askTutor({
        question: textToAsk,
        subject,
        learningObjectiveId: loId || null,
      });

      if (response?.success && response?.data) {
        const data = response.data;
        const tutorMsg = {
          id: `msg-${Date.now()}-a`,
          role: 'tutor',
          content: data.answer,
          socratic_follow_up: data.socratic_follow_up,
          remediation_mode_active: Boolean(data.remediation_mode_active),
          citations: data.citations || [],
          out_of_syllabus: Boolean(data.metadata?.out_of_syllabus),
          timestamp: new Date().toISOString(),
        };

        setMessages((prev) => [...prev, tutorMsg]);

        // Cache in Dexie for offline reading
        await cacheTutorThread({
          student_id: student?.id || 'guest',
          subject,
          question: textToAsk,
          answer: data.answer,
          socratic_follow_up: data.socratic_follow_up,
          remediation_mode_active: data.remediation_mode_active,
          citations: data.citations,
        });
      } else {
        throw new Error(response?.message || 'Could not synthesize answer from curriculum.');
      }
    } catch (err) {
      console.error('Tutor ask error:', err);
      let userFriendlyError = err.message || 'Failed to connect to tutor service.';
      if (err.isOffline || !syncState.isOnline) {
        userFriendlyError = 'You are offline. Showing cached answers from your local storage.';
      }
      setErrorMessage(userFriendlyError);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto py-6 px-4 sm:px-6">
      {/* Subject Selector & Context Header */}
      <div className="classroom-card p-4 mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <label htmlFor="subject-select" className="text-xs font-bold uppercase tracking-wider text-slate-700">
            Subject:
          </label>
          <select
            id="subject-select"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="min-h-[44px] px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm font-semibold text-slate-900 focus:ring-2 focus:ring-brand-500"
          >
            <option value="Science">Science (NCERT / OpenStax)</option>
            <option value="Mathematics">Mathematics</option>
            <option value="Social Studies">Social Studies</option>
          </select>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-700">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <span>Curriculum Grade {student?.current_grade || 7} Grounded</span>
        </div>
      </div>

      {/* Suggested Topic Starter Chips (Quick 1-tap Doubts) */}
      {messages.length === 0 && (
        <div className="mb-6">
          <p className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span>Try asking a textbook question:</span>
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {SUGGESTED_QUESTIONS.map((q, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  setSubject(q.subject);
                  handleAsk(q.text, q.loId);
                }}
                className="btn-touch p-3 text-left bg-white hover:bg-brand-50 border border-slate-200 hover:border-brand-300 rounded-xl transition-all group"
              >
                <div className="flex items-start gap-2">
                  <HelpCircle className="w-4 h-4 text-brand-600 mt-0.5 flex-shrink-0 group-hover:scale-110 transition-transform" />
                  <span className="text-xs font-medium text-slate-800 leading-snug">{q.text}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Chat Thread Messages */}
      <div className="space-y-4 mb-6">
        {messages.length === 0 && !loading && (
          <EmptyState
            title="Socratic Curriculum Tutor Ready"
            description="Type a question or homework doubt. SyncScholar guides you step-by-step using verified NCERT / OpenStax textbooks without giving away direct answers."
            iconType="books"
          />
        )}

        {messages.map((msg, index) => (
          <div key={msg.id || index} className="animate-fadeIn">
            {msg.role === 'student' ? (
              /* Student Question Bubble */
              <div className="flex justify-end">
                <div className="max-w-[85%] sm:max-w-[75%] bg-brand-700 text-white p-4 rounded-2xl rounded-tr-sm shadow-sm">
                  <div className="flex items-center justify-between text-[11px] text-brand-200 mb-1">
                    <span className="font-semibold">You ({msg.subject || 'Student'})</span>
                  </div>
                  <p className="text-sm sm:text-base leading-relaxed font-normal">{msg.content}</p>
                </div>
              </div>
            ) : (
              /* AI Socratic Tutor Response Bubble */
              <div className="flex justify-start">
                <div className="max-w-[95%] sm:max-w-[90%] classroom-card p-5 border-l-4 border-l-brand-600">
                  {/* Header with Role and Foundation Badge */}
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3 pb-2 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-bold text-xs">
                        AI
                      </div>
                      <span className="text-xs font-bold text-slate-900">Socratic Tutor</span>
                    </div>

                    {/* Subtle Prerequisite Foundation Mode Badge (Mandated by Prompt) */}
                    {msg.remediation_mode_active && (
                      <div
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 border border-amber-200 text-amber-900 rounded-full text-xs font-medium"
                        title="Mastery < 50%: Adaptive retrieval included foundational concepts from earlier grades"
                      >
                        <Layers className="w-3.5 h-3.5 text-amber-600" />
                        <span>🌱 Prerequisite Foundation Mode Active</span>
                      </div>
                    )}

                    {msg.out_of_syllabus && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-full text-xs font-medium">
                        <AlertCircle className="w-3 h-3 text-rose-600" />
                        Curriculum Gated
                      </span>
                    )}
                  </div>

                  {/* Main Grounded Answer Text */}
                  <div className="text-sm sm:text-base text-slate-800 leading-relaxed space-y-2 whitespace-pre-line font-normal">
                    {msg.content}
                  </div>

                  {/* Socratic Guiding Hint Callout Box (Mandated by Prompt) */}
                  {msg.socratic_follow_up && (
                    <div className="mt-4 p-4 bg-sky-50 border-l-4 border-l-sky-500 rounded-r-xl text-sky-950">
                      <div className="flex items-center gap-1.5 font-bold text-xs uppercase tracking-wider text-sky-900 mb-1.5">
                        <Sparkles className="w-4 h-4 text-sky-600" />
                        <span>Socratic Guiding Clue & Next Step</span>
                      </div>
                      <p className="text-sm leading-relaxed font-medium">{msg.socratic_follow_up}</p>
                    </div>
                  )}

                  {/* Expandable NCERT / OpenStax Source Citation Cards (Mandated by Prompt) */}
                  {msg.citations && msg.citations.length > 0 && (
                    <div className="mt-4 pt-3 border-t border-slate-100">
                      <div className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <BookOpen className="w-3.5 h-3.5 text-brand-600" />
                        <span>Verified Textbook Sources ({msg.citations.length})</span>
                      </div>

                      <div className="space-y-2">
                        {msg.citations.map((citation, citIdx) => {
                          const isExpanded = expandedCitations[`${index}-${citIdx}`];
                          return (
                            <div
                              key={citIdx}
                              className="border border-slate-200 rounded-lg p-2.5 bg-slate-50 text-xs transition-colors hover:bg-slate-100/70"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-slate-900">
                                    {citation.chapter_title || 'General Curriculum'}
                                  </span>
                                  <span className="px-1.5 py-0.5 bg-brand-100 text-brand-800 font-bold rounded text-[10px]">
                                    Class {citation.grade_level || '7'}
                                  </span>
                                  {citation.page_number && (
                                    <span className="text-slate-700 font-medium">Page {citation.page_number}</span>
                                  )}
                                </div>

                                <div className="flex items-center gap-2">
                                  {citation.source_url && (
                                    <a
                                      href={citation.source_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="btn-touch px-2 py-1 text-brand-700 hover:text-brand-900 font-medium flex items-center gap-1"
                                      title="Open official NCERT textbook page"
                                    >
                                      <span>Textbook Link</span>
                                      <ExternalLink className="w-3 h-3" />
                                    </a>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => toggleCitation(index, citIdx)}
                                    className="btn-touch p-1 text-slate-500 hover:text-slate-800"
                                    aria-label="Toggle citation details"
                                  >
                                    {isExpanded ? (
                                      <ChevronUp className="w-4 h-4" />
                                    ) : (
                                      <ChevronDown className="w-4 h-4" />
                                    )}
                                  </button>
                                </div>
                              </div>

                              {isExpanded && (
                                <div className="mt-2 pt-2 border-t border-slate-200 text-slate-600 text-[11px] leading-relaxed">
                                  <p>
                                    <strong>Source Verification:</strong> Grounded in verified state textbook curriculum standards under SDG 4 open education guidelines.
                                  </p>
                                  {citation.source_url && (
                                    <p className="mt-1 truncate">
                                      <strong>URL:</strong>{' '}
                                      <a
                                        href={citation.source_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-brand-600 hover:underline"
                                      >
                                        {citation.source_url}
                                      </a>
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Loading Skeleton */}
        {loading && (
          <div className="flex justify-start animate-pulse">
            <div className="w-full sm:max-w-[85%] classroom-card p-5 border-l-4 border-l-brand-400">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded-full bg-slate-200" />
                <div className="h-4 w-32 bg-slate-200 rounded" />
              </div>
              <div className="space-y-2.5">
                <div className="h-4 bg-slate-200 rounded w-full" />
                <div className="h-4 bg-slate-200 rounded w-5/6" />
                <div className="h-4 bg-slate-200 rounded w-4/6" />
              </div>
              <div className="mt-4 p-3 bg-slate-100 rounded-lg">
                <div className="h-3.5 bg-slate-200 rounded w-3/4" />
              </div>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Human-Readable Error Notice */}
      {errorMessage && (
        <div className="mb-4 p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-900 text-sm flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-rose-600 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p className="font-semibold">{errorMessage}</p>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-xs text-rose-600 hover:underline font-bold px-2 py-1"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Doubt Input Form (Touch-Friendly >= 44px) */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleAsk();
        }}
        className="classroom-card p-2 sm:p-3 flex items-center gap-2 shadow-md sticky bottom-4 bg-white/95 backdrop-blur-sm"
      >
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={`Ask your ${subject} doubt (e.g. "Why does ice melt faster in warm water?")...`}
          className="flex-1 min-h-[44px] px-3.5 py-2 text-sm sm:text-base bg-transparent border-0 focus:ring-0 text-slate-900 placeholder:text-slate-400 outline-none"
          disabled={loading}
          maxLength={1000}
        />

        <button
          type="submit"
          disabled={loading || !question.trim()}
          className="btn-touch px-4 py-2 bg-brand-600 hover:bg-brand-700 disabled:bg-slate-300 text-white font-semibold rounded-lg shadow-sm flex items-center gap-1.5 transition-all text-sm"
          aria-label="Send doubt question"
        >
          <span>Ask</span>
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}

export default TutorView;
