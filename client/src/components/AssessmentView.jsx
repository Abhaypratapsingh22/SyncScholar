/**
 * @file AssessmentView.jsx
 * @description Practice Quiz & Flashcard Deck View for SyncScholar.
 * 
 * Features:
 * 1. 3-Question Diagnostic Micro-Quiz with 44px tap targets
 * 2. Swipe/Tap-to-flip study flashcards with textbook citations
 * 3. Immediate textbook-grounded explanations after each answer
 * 4. Visual mastery progress bars (EMA score tracking)
 * 5. Dexie.js offline-first queueing with idempotent client_attempt_id UUIDs
 * 6. Resilient online/offline states, cached card decks, and graceful RAG limits
 */

import React, { useState, useEffect } from 'react';
import { api } from '../services/api.js';
import {
  queuePendingQuizSubmission,
  markQuizSubmissionSynced,
  clearSyncedQuizSubmissions,
  cacheFlashcardDeck,
  cacheQuiz,
  getCachedFlashcards,
  getCachedQuiz,
  generateClientAttemptUuid,
} from '../db/offlineDb.js';
import { syncService } from '../services/syncService.js';
import { EmptyState } from './EmptyState.jsx';
import {
  CheckCircle2,
  XCircle,
  HelpCircle,
  Sparkles,
  RotateCw,
  BookOpen,
  Award,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Layers,
  Flame,
  Check,
  WifiOff,
  CloudUpload,
} from 'lucide-react';

const TOPIC_PRESETS = [
  {
    subject: 'Science',
    loId: 'SCI-07-HEAT-04',
    title: 'Heat Conduction & Insulators (Class 7)',
  },
  {
    subject: 'Science',
    loId: 'SCI-07-NUTR-01',
    title: 'Nutrition in Plants & Photosynthesis (Class 7)',
  },
  {
    subject: 'Mathematics',
    loId: 'MAT-07-FRAC-02',
    title: 'Fractions & Rational Numbers (Class 7)',
  },
];

// Fallback high-quality offline starter deck in case school starts completely offline
const OFFLINE_FALLBACK_DECK = {
  subject: 'Science',
  grade_level: 7,
  learning_objective_id: 'SCI-07-HEAT-04',
  topic_query: 'Heat Transfer and Conduction',
  questions: [
    {
      question: 'Why do metal utensils often have wooden or plastic handles when used for cooking?',
      options: [
        'Wood and plastic are poor conductors (insulators) of heat, preventing burns.',
        'Metals cool down too quickly without wooden support.',
        'Wood attracts heat from the flame to cook food faster.',
        'Plastic increases the temperature of the boiling liquid.',
      ],
      correct_index: 0,
      explanation: 'According to NCERT Class 7 Science Chapter 4 (Heat), materials that do not allow heat to pass through them easily are poor conductors of heat, also known as insulators. Wood and plastic protect hands from heat conduction.',
      learning_objective_id: 'SCI-07-HEAT-04',
    },
    {
      question: 'Which method of heat transfer occurs through direct contact between solid particles without movement of the material as a whole?',
      options: [
        'Radiation',
        'Convection',
        'Conduction',
        'Sublimation',
      ],
      correct_index: 2,
      explanation: 'Conduction is the process by which heat is transferred from the hotter end to the colder end of an object in solids through molecular collisions.',
      learning_objective_id: 'SCI-07-HEAT-04',
    },
    {
      question: 'In which direction does heat always naturally flow between two objects in contact?',
      options: [
        'From the object with higher temperature to the object with lower temperature',
        'From the larger object to the smaller object',
        'From cold objects to hot objects until frozen',
        'Heat only flows when external electricity is applied',
      ],
      correct_index: 0,
      explanation: 'Heat always flows naturally from a body at a higher temperature to a body at a lower temperature until thermal equilibrium is reached.',
      learning_objective_id: 'SCI-07-HEAT-04',
    },
  ],
  flashcards: [
    {
      front: 'What is Conduction of Heat?',
      back: 'The transfer of heat from the hotter end to the colder end of a solid object without overall movement of the substance. (NCERT Class 7 Science, Ch. 4, p. 40)',
      chapter_title: 'Heat',
      page_number: 40,
    },
    {
      front: 'What is the difference between a Conductor and an Insulator?',
      back: 'Conductors (e.g., copper, iron, aluminum) let heat flow easily. Insulators (e.g., wood, plastic, air) resist heat flow and protect us from burns.',
      chapter_title: 'Heat',
      page_number: 41,
    },
    {
      front: 'Why is air considered an insulator of heat?',
      back: 'Air molecules are far apart and transfer thermal energy very poorly by conduction, which is why double-paned glass or woollen clothes trap body heat.',
      chapter_title: 'Heat',
      page_number: 42,
    },
  ],
};

export function AssessmentView({ student, syncState }) {
  const [activeSubTab, setActiveSubTab] = useState('quiz'); // 'quiz' | 'flashcards'
  const [selectedTopic, setSelectedTopic] = useState(TOPIC_PRESETS[0]);
  const [loading, setLoading] = useState(false);
  const [assessmentData, setAssessmentData] = useState(OFFLINE_FALLBACK_DECK);
  const [feedbackMessage, setFeedbackMessage] = useState(null);

  // Quiz Mode State
  const [userAnswers, setUserAnswers] = useState({}); // { [questionIndex]: optionIndex }
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [quizScore, setQuizScore] = useState(0);
  const [submissionStatus, setSubmissionStatus] = useState(null); // 'online' | 'offline_queued'

  // Flashcards Mode State
  const [cardIndex, setCardIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [masteredCards, setMasteredCards] = useState(new Set());

  const isOnline = syncState?.isOnline ?? true;

  // Hydrate local cache or fallback for the selected topic
  useEffect(() => {
    async function loadCache() {
      try {
        const cachedQuiz = await getCachedQuiz(selectedTopic.subject, selectedTopic.loId);
        const cachedCards = await getCachedFlashcards(selectedTopic.subject, selectedTopic.loId);

        if (cachedQuiz || cachedCards) {
          setAssessmentData({
            subject: selectedTopic.subject,
            learning_objective_id: selectedTopic.loId,
            grade_level: student?.current_grade || 7,
            questions: cachedQuiz?.questions || [],
            flashcards: cachedCards?.cards || [],
          });
        } else if (selectedTopic.loId === 'SCI-07-HEAT-04') {
          // Pre-cache fallback deck for instant offline use only for SCI-07-HEAT-04
          await cacheQuiz({
            id: `${selectedTopic.subject}_${selectedTopic.loId}`,
            subject: selectedTopic.subject,
            learning_objective_id: selectedTopic.loId,
            grade_level: 7,
            questions: OFFLINE_FALLBACK_DECK.questions,
          });
          await cacheFlashcardDeck({
            id: `${selectedTopic.subject}_${selectedTopic.loId}`,
            subject: selectedTopic.subject,
            learning_objective_id: selectedTopic.loId,
            grade_level: 7,
            cards: OFFLINE_FALLBACK_DECK.flashcards,
          });
          setAssessmentData(OFFLINE_FALLBACK_DECK);
        } else {
          // Unmatched topic without cached records: show empty state
          setAssessmentData({
            subject: selectedTopic.subject,
            learning_objective_id: selectedTopic.loId,
            grade_level: student?.current_grade || 7,
            questions: [],
            flashcards: [],
          });
        }
      } catch (err) {
        console.warn('Cache load warning:', err);
      }
    }
    loadCache();
  }, [selectedTopic, student]);

  const handleGenerateAssessment = async () => {
    if (!isOnline) {
      setFeedbackMessage({
        type: 'info',
        text: 'Live RAG generation is unavailable offline. Reviewing cached textbook deck.',
      });
      return;
    }

    setLoading(true);
    setFeedbackMessage(null);
    setQuizSubmitted(false);
    setUserAnswers({});
    setCardIndex(0);
    setIsFlipped(false);

    try {
      const response = await api.generateAssessment({
        subject: selectedTopic.subject,
        learning_objective_id: selectedTopic.loId,
        topic_query: selectedTopic.title,
        grade_level: student?.current_grade || 7,
      });

      if (response?.success && response?.data) {
        setAssessmentData(response.data);
        // Cache in Dexie for offline use
        const cacheId = `${selectedTopic.subject}_${selectedTopic.loId}`;
        await cacheQuiz({
          id: cacheId,
          subject: selectedTopic.subject,
          learning_objective_id: selectedTopic.loId,
          grade_level: student?.current_grade || 7,
          questions: response.data.questions || [],
        });
        await cacheFlashcardDeck({
          id: cacheId,
          subject: selectedTopic.subject,
          learning_objective_id: selectedTopic.loId,
          grade_level: student?.current_grade || 7,
          cards: response.data.flashcards || [],
        });

        setFeedbackMessage({
          type: 'success',
          text: 'Fresh textbook diagnostic questions loaded!',
        });
      } else {
        throw new Error(response?.message || 'Could not generate assessment.');
      }
    } catch (err) {
      console.warn('Assessment generation fallback to cache:', err);
      // Fall back to local Dexie cache
      const cachedQuiz = await getCachedQuiz(selectedTopic.subject, selectedTopic.loId);
      const cachedCards = await getCachedFlashcards(selectedTopic.subject, selectedTopic.loId);

      if (cachedQuiz || cachedCards) {
        setAssessmentData({
          subject: selectedTopic.subject,
          learning_objective_id: selectedTopic.loId,
          grade_level: student?.current_grade || 7,
          questions: cachedQuiz?.questions || [],
          flashcards: cachedCards?.cards || [],
        });
        setFeedbackMessage({
          type: 'info',
          text: 'Using cached diagnostic deck from your offline storage.',
        });
      } else if (selectedTopic.loId === 'SCI-07-HEAT-04') {
        setAssessmentData(OFFLINE_FALLBACK_DECK);
        setFeedbackMessage({
          type: 'info',
          text: 'Loaded verified curriculum starter deck for offline practice.',
        });
      } else {
        setAssessmentData({
          subject: selectedTopic.subject,
          learning_objective_id: selectedTopic.loId,
          grade_level: student?.current_grade || 7,
          questions: [],
          flashcards: [],
        });
        setFeedbackMessage({
          type: 'info',
          text: 'No cached assessment available for this topic offline.',
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleOptionSelect = (qIdx, optIdx) => {
    if (quizSubmitted) return;
    setUserAnswers((prev) => ({
      ...prev,
      [qIdx]: optIdx,
    }));
  };

  const handleSubmitQuiz = async () => {
    const questions = assessmentData.questions || [];
    if (questions.length === 0) return;

    // Calculate score
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
        learning_objective_id: q.learning_objective_id || selectedTopic.loId,
      };
    });

    setQuizScore(correctCount);
    setQuizSubmitted(true);

    const clientAttemptUuid = generateClientAttemptUuid();
    const attemptPayload = {
      client_attempt_id: clientAttemptUuid,
      student_id: student?.id || student?._id || 'offline_student',
      learning_objective_id: selectedTopic.loId,
      subject: selectedTopic.subject,
      grade_level: student?.current_grade || 7,
      questions: formattedQuestions,
      score: correctCount,
      max_score: questions.length,
    };

    // Always persist to Dexie pending store first to guarantee zero attempt loss (AGENTS.md Mandate)
    await queuePendingQuizSubmission(attemptPayload);
    await syncService.refreshPendingCount();

    // If online, immediately try submitting to server
    if (isOnline) {
      try {
        await api.submitQuizAttempt({
          client_attempt_id: clientAttemptUuid,
          learning_objective_id: selectedTopic.loId,
          subject: selectedTopic.subject,
          grade_level: student?.current_grade || 7,
          questions: formattedQuestions,
          synced_from_offline: false,
        });

        // Mark synced and delete from queue
        await markQuizSubmissionSynced(clientAttemptUuid);
        await clearSyncedQuizSubmissions([clientAttemptUuid]);
        await syncService.refreshPendingCount();

        setSubmissionStatus('online');
      } catch (err) {
        console.warn('Direct submission deferred to background sync:', err);
        setSubmissionStatus('offline_queued');
      }
    } else {
      setSubmissionStatus('offline_queued');
    }
  };

  const handleResetQuiz = () => {
    setUserAnswers({});
    setQuizSubmitted(false);
    setQuizScore(0);
    setSubmissionStatus(null);
  };

  // Flashcards helpers
  const currentCard = assessmentData.flashcards?.[cardIndex] || null;
  const totalCards = assessmentData.flashcards?.length || 0;

  const toggleCardMastered = (idx) => {
    setMasteredCards((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  };

  const handlePrevCard = () => {
    setIsFlipped(false);
    setCardIndex((prev) => (prev > 0 ? prev - 1 : totalCards - 1));
  };

  const handleNextCard = () => {
    setIsFlipped(false);
    setCardIndex((prev) => (prev < totalCards - 1 ? prev + 1 : 0));
  };

  return (
    <div className="max-w-4xl mx-auto py-6 px-4 sm:px-6">
      {/* Offline Mode Active Banner */}
      {!isOnline && (
        <div className="mb-4 p-3.5 bg-amber-50/90 border border-amber-200 rounded-xl text-amber-900 text-xs flex items-center gap-2.5 shadow-xs">
          <WifiOff className="w-4 h-4 text-amber-700 flex-shrink-0" />
          <div className="flex-1">
            <span className="font-bold">Offline Study Active: </span>
            <span>
              Browsing cached NCERT flashcards and diagnostic quizzes. All completed quiz attempts are stored safely in local IndexedDB and will auto-sync when back online.
            </span>
          </div>
        </div>
      )}

      {/* Top Controls & Topic Selector */}
      <div className="classroom-card p-4 sm:p-5 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-bold text-slate-900 tracking-tight">Formative Mastery & Practice</h2>
            <p className="text-xs text-slate-600">3-question micro-quizzes and tap-to-flip study cards</p>
          </div>

          {/* Sub-tab Switcher */}
          <div className="flex p-1 bg-slate-100 rounded-xl">
            <button
              type="button"
              onClick={() => setActiveSubTab('quiz')}
              className={`btn-touch px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${
                activeSubTab === 'quiz'
                  ? 'bg-white text-brand-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Diagnostic Micro-Quiz
            </button>
            <button
              type="button"
              onClick={() => setActiveSubTab('flashcards')}
              className={`btn-touch px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${
                activeSubTab === 'flashcards'
                  ? 'bg-white text-brand-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Study Flashcards
            </button>
          </div>
        </div>

        {/* Topic Selector & Generator */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <label htmlFor="topic-select" className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Topic:
            </label>
            <select
              id="topic-select"
              value={selectedTopic.loId}
              onChange={(e) => {
                const found = TOPIC_PRESETS.find((t) => t.loId === e.target.value) || TOPIC_PRESETS[0];
                setSelectedTopic(found);
                setQuizSubmitted(false);
                setUserAnswers({});
              }}
              className="min-h-[44px] px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs sm:text-sm font-semibold text-slate-900 focus:ring-2 focus:ring-brand-500"
            >
              {TOPIC_PRESETS.map((t) => (
                <option key={t.loId} value={t.loId}>
                  {t.title}
                </option>
              ))}
            </select>
          </div>

          {/* Live RAG Generation Button (Gracefully disabled when offline) */}
          <button
            type="button"
            onClick={handleGenerateAssessment}
            disabled={loading || !isOnline}
            className={`btn-touch px-4 py-2 text-xs font-bold rounded-lg shadow-sm flex items-center gap-1.5 transition-all ${
              isOnline
                ? 'bg-brand-600 hover:bg-brand-700 text-white'
                : 'bg-slate-200 text-slate-500 cursor-not-allowed border border-slate-300'
            }`}
            title={!isOnline ? 'Live generation paused while offline. Using cached deck.' : 'Fetch fresh questions from textbook'}
          >
            {loading ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : isOnline ? (
              <Sparkles className="w-3.5 h-3.5" />
            ) : (
              <WifiOff className="w-3.5 h-3.5 text-slate-500" />
            )}
            <span>
              {loading
                ? 'Retrieving Textbook...'
                : isOnline
                ? 'New Textbook Questions'
                : 'Live Generation Paused (Offline)'}
            </span>
          </button>
        </div>

        {/* Feedback message */}
        {feedbackMessage && (
          <div
            className={`mt-3 p-2.5 rounded-lg text-xs font-medium flex items-center justify-between ${
              feedbackMessage.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-blue-50 text-blue-800 border border-blue-200'
            }`}
          >
            <span>{feedbackMessage.text}</span>
            <button
              type="button"
              onClick={() => setFeedbackMessage(null)}
              className="text-slate-500 hover:text-slate-800 font-bold px-1"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* MODE 1: 3-QUESTION DIAGNOSTIC MICRO-QUIZ */}
      {/* ========================================================================= */}
      {activeSubTab === 'quiz' && (
        <div className="space-y-6">
          {assessmentData.questions && assessmentData.questions.length > 0 ? (
            assessmentData.questions.map((q, qIndex) => {
              const selectedOpt = userAnswers[qIndex];

              return (
                <div key={qIndex} className="classroom-card p-5 sm:p-6 transition-all">
                  {/* Question Header */}
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <span className="px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider bg-brand-100 text-brand-800 rounded-md">
                      Question {qIndex + 1} of {assessmentData.questions.length}
                    </span>
                    <span className="text-xs text-slate-600 font-medium">
                      LO: {q.learning_objective_id || selectedTopic.loId}
                    </span>
                  </div>

                  {/* Question Text */}
                  <p className="text-base sm:text-lg font-semibold text-slate-900 mb-4 leading-relaxed">
                    {q.question}
                  </p>

                  {/* Options (Minimum 44px tap targets for mobile/touch screens) */}
                  <div className="space-y-2.5">
                    {q.options.map((optText, optIndex) => {
                      const isSelected = selectedOpt === optIndex;
                      const isCorrect = optIndex === q.correct_index;

                      let buttonStyles =
                        'border-slate-200 bg-white hover:bg-slate-50 text-slate-800 hover:border-slate-300';

                      if (quizSubmitted) {
                        if (isCorrect) {
                          buttonStyles = 'border-emerald-500 bg-emerald-50 text-emerald-950 font-semibold';
                        } else if (isSelected && !isCorrect) {
                          buttonStyles = 'border-rose-400 bg-rose-50 text-rose-950 line-through';
                        } else {
                          buttonStyles = 'border-slate-100 bg-slate-50 text-slate-600 opacity-70';
                        }
                      } else if (isSelected) {
                        buttonStyles = 'border-brand-600 bg-brand-50 text-brand-900 font-semibold ring-1 ring-brand-500';
                      }

                      return (
                        <button
                          key={optIndex}
                          type="button"
                          onClick={() => handleOptionSelect(qIndex, optIndex)}
                          disabled={quizSubmitted}
                          className={`btn-touch w-full p-3.5 text-left rounded-xl border text-sm sm:text-base transition-all flex items-start gap-3 ${buttonStyles}`}
                        >
                          <span className="w-6 h-6 rounded-full border border-current flex items-center justify-center font-bold text-xs flex-shrink-0 mt-0.5">
                            {String.fromCharCode(65 + optIndex)}
                          </span>
                          <span className="flex-1 leading-normal">{optText}</span>
                          {quizSubmitted && isCorrect && (
                            <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                          )}
                          {quizSubmitted && isSelected && !isCorrect && (
                            <XCircle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Immediate Textbook-Grounded Explanation (Mandated by Prompt) */}
                  {quizSubmitted && (
                    <div className="mt-4 p-4 rounded-xl bg-slate-50 border border-slate-200 text-sm leading-relaxed text-slate-800">
                      <div className="flex items-center gap-1.5 font-bold text-xs uppercase tracking-wider text-slate-700 mb-1">
                        <BookOpen className="w-4 h-4 text-brand-600" />
                        <span>Curriculum Explanation & Source Grounding</span>
                      </div>
                      <p>{q.explanation}</p>
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <EmptyState
              title="No Quiz Available"
              description="Click 'New Textbook Questions' above to load curriculum diagnostic questions."
              iconType="quiz"
            />
          )}

          {/* Submission and Mastery Progress Section */}
          {assessmentData.questions && assessmentData.questions.length > 0 && (
            <div className="classroom-card p-5 sm:p-6 bg-slate-900 text-white">
              {!quizSubmitted ? (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h3 className="font-bold text-base">Ready to Evaluate?</h3>
                    <p className="text-xs text-slate-300">
                      Answered: {Object.keys(userAnswers).length} of {assessmentData.questions.length} questions
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleSubmitQuiz}
                    disabled={Object.keys(userAnswers).length === 0}
                    className="btn-touch px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white font-bold rounded-xl shadow-md text-sm transition-all"
                  >
                    Submit Quiz & Update Mastery
                  </button>
                </div>
              ) : (
                <div>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <Award className="w-6 h-6 text-amber-400" />
                        <h3 className="font-bold text-lg text-white">
                          Quiz Completed: {quizScore} / {assessmentData.questions.length} Correct
                        </h3>
                      </div>
                      <p className="text-xs text-slate-300 mt-1">
                        {submissionStatus === 'online' ? (
                          <span className="text-emerald-400 font-semibold">
                            ✅ Synced: Mastery score updated on cloud student profile.
                          </span>
                        ) : (
                          <span className="text-amber-300 font-semibold flex items-center gap-1">
                            <CloudUpload className="w-3.5 h-3.5 inline" />
                            Saved to local IndexedDB queue. Score recorded locally and will auto-sync when online.
                          </span>
                        )}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={handleResetQuiz}
                      className="btn-touch px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white font-semibold rounded-lg text-xs flex items-center gap-1.5 border border-slate-700"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                      <span>Retake Quiz</span>
                    </button>
                  </div>

                  {/* Visual Mastery Progress Bar */}
                  <div>
                    <div className="flex justify-between text-xs font-medium text-slate-300 mb-1">
                      <span>Concept Diagnostic Score</span>
                      <span className="font-bold text-white">
                        {Math.round((quizScore / assessmentData.questions.length) * 100)}%
                      </span>
                    </div>
                    <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden border border-slate-700">
                      <div
                        className={`h-full transition-all duration-500 rounded-full ${
                          quizScore === 3
                            ? 'bg-emerald-500'
                            : quizScore === 2
                            ? 'bg-brand-500'
                            : 'bg-amber-500'
                        }`}
                        style={{
                          width: `${(quizScore / assessmentData.questions.length) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODE 2: SWIPE / TAP-TO-FLIP STUDY FLASHCARDS */}
      {/* ========================================================================= */}
      {activeSubTab === 'flashcards' && (
        <div className="space-y-6">
          {totalCards > 0 && currentCard ? (
            <div>
              {/* Flashcard Card Deck Container */}
              <div
                onClick={() => setIsFlipped(!isFlipped)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setIsFlipped(!isFlipped);
                  }
                }}
                aria-label={`Flashcard ${cardIndex + 1} of ${totalCards}. Tap to flip.`}
                className="classroom-card min-h-[300px] sm:min-h-[340px] p-6 sm:p-8 flex flex-col justify-between cursor-pointer border-2 hover:border-brand-400 transition-all shadow-md select-none bg-gradient-to-b from-white to-slate-50/50"
              >
                {/* Top Card Badge & Mastered Toggle */}
                <div className="flex items-center justify-between">
                  <span className="px-2.5 py-1 text-xs font-bold uppercase tracking-wider bg-brand-50 text-brand-700 rounded-md border border-brand-200">
                    Card {cardIndex + 1} of {totalCards}
                  </span>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleCardMastered(cardIndex);
                    }}
                    className={`btn-touch px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 transition-colors ${
                      masteredCards.has(cardIndex)
                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>{masteredCards.has(cardIndex) ? 'Mastered' : 'Mark Mastered'}</span>
                  </button>
                </div>

                {/* Card Content (Front vs Back) */}
                <div className="py-6 text-center my-auto">
                  {!isFlipped ? (
                    <div>
                      <p className="text-xs uppercase font-bold tracking-widest text-brand-600 mb-2">
                        Question / Concept
                      </p>
                      <h3 className="text-lg sm:text-2xl font-bold text-slate-900 leading-snug">
                        {currentCard.front}
                      </h3>
                      <p className="text-xs text-slate-600 mt-4 flex items-center justify-center gap-1">
                        <RotateCw className="w-3 h-3 text-slate-500" />
                        <span>Tap anywhere to flip for textbook explanation</span>
                      </p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-xs uppercase font-bold tracking-widest text-emerald-600 mb-2">
                        NCERT Grounded Answer
                      </p>
                      <p className="text-base sm:text-lg text-slate-800 leading-relaxed font-medium">
                        {currentCard.back}
                      </p>
                      {currentCard.page_number && (
                        <div className="mt-4 inline-flex items-center gap-1.5 px-3 py-1 bg-brand-50 border border-brand-200 rounded-md text-xs text-brand-800 font-semibold">
                          <BookOpen className="w-3.5 h-3.5" />
                          <span>
                            {currentCard.chapter_title || 'Textbook'} — Page {currentCard.page_number}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Bottom Mastery Indicator */}
                <div className="flex items-center justify-between text-xs text-slate-600 pt-3 border-t border-slate-100">
                  <span>Topic: {selectedTopic.loId}</span>
                  <span>{isFlipped ? 'Showing Answer' : 'Showing Question'}</span>
                </div>
              </div>

              {/* Navigation & Deck Progress Bar */}
              <div className="mt-4 flex items-center justify-between gap-4">
                <button
                  type="button"
                  onClick={handlePrevCard}
                  className="btn-touch px-4 py-2 bg-white hover:bg-slate-100 text-slate-800 rounded-xl border border-slate-200 font-semibold text-xs flex items-center gap-1 shadow-xs"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span>Previous</span>
                </button>

                <div className="text-xs font-semibold text-slate-600">
                  Mastered: {masteredCards.size} / {totalCards}
                </div>

                <button
                  type="button"
                  onClick={handleNextCard}
                  className="btn-touch px-4 py-2 bg-white hover:bg-slate-100 text-slate-800 rounded-xl border border-slate-200 font-semibold text-xs flex items-center gap-1 shadow-xs"
                >
                  <span>Next</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            <EmptyState
              title="No Flashcards Available"
              description="Click 'New Textbook Questions' above to load curriculum study cards."
              iconType="flashcards"
            />
          )}
        </div>
      )}
    </div>
  );
}

export default AssessmentView;
