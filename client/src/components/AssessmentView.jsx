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
 * 6. Resilient online/offline states and caching
 */

import React, { useState, useEffect } from 'react';
import { api } from '../services/api.js';
import {
  queueOfflineQuizAttempt,
  cacheAssessment,
  getCachedAssessment,
  getAllCachedFlashcardDecks,
  generateClientAttemptUuid,
} from '../db/indexedDb.js';
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

  // Load existing cached assessment if available
  useEffect(() => {
    async function loadCache() {
      try {
        const cacheKey = `${selectedTopic.subject}_${selectedTopic.loId}`;
        const cached = await getCachedAssessment(cacheKey);
        if (cached && cached.questions && cached.questions.length > 0) {
          setAssessmentData(cached);
        } else {
          // Pre-cache fallback deck for instant offline use
          await cacheAssessment(cacheKey, OFFLINE_FALLBACK_DECK);
        }
      } catch (err) {
        console.warn('Cache load warning:', err);
      }
    }
    loadCache();
  }, [selectedTopic]);

  const handleGenerateAssessment = async () => {
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
        const cacheKey = `${selectedTopic.subject}_${selectedTopic.loId}`;
        await cacheAssessment(cacheKey, response.data);
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
      const cacheKey = `${selectedTopic.subject}_${selectedTopic.loId}`;
      const cached = await getCachedAssessment(cacheKey);
      if (cached) {
        setAssessmentData(cached);
        setFeedbackMessage({
          type: 'info',
          text: 'Using cached diagnostic deck from your offline storage.',
        });
      } else {
        setAssessmentData(OFFLINE_FALLBACK_DECK);
        setFeedbackMessage({
          type: 'info',
          text: 'Loaded verified curriculum starter deck for offline practice.',
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
      student_id: student?.id || 'offline_student',
      learning_objective_id: selectedTopic.loId,
      subject: selectedTopic.subject,
      grade_level: student?.current_grade || 7,
      questions: formattedQuestions,
      score: correctCount,
      max_score: questions.length,
    };

    // Always persist to Dexie first for offline resilience (AGENTS.md Mandate)
    await queueOfflineQuizAttempt(attemptPayload);

    // If online, immediately try submitting to server
    if (syncState.isOnline) {
      try {
        await api.submitQuizAttempt({
          client_attempt_id: clientAttemptUuid,
          learning_objective_id: selectedTopic.loId,
          subject: selectedTopic.subject,
          grade_level: student?.current_grade || 7,
          questions: formattedQuestions,
          synced_from_offline: false,
        });
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

  return (
    <div className="max-w-4xl mx-auto py-6 px-4 sm:px-6">
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

          <button
            type="button"
            onClick={handleGenerateAssessment}
            disabled={loading}
            className="btn-touch px-4 py-2 bg-brand-600 hover:bg-brand-700 disabled:bg-slate-300 text-white text-xs font-bold rounded-lg shadow-sm flex items-center gap-1.5 transition-all"
          >
            {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            <span>{loading ? 'Retrieving Textbook...' : 'New Textbook Questions'}</span>
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
          {/* Questions Container */}
          {assessmentData.questions && assessmentData.questions.length > 0 ? (
            assessmentData.questions.map((q, qIndex) => {
              const selectedOpt = userAnswers[qIndex];
              const isAnswered = selectedOpt !== undefined;

              return (
                <div key={qIndex} className="classroom-card p-5 sm:p-6 transition-all">
                  {/* Question Header */}
                  <div className="flex items-center justify-between mb-3">
                    <span className="px-2.5 py-1 bg-brand-50 text-brand-800 font-bold text-xs rounded-md border border-brand-200">
                      Question {qIndex + 1} of {assessmentData.questions.length}
                    </span>
                    <span className="text-xs text-slate-700 font-medium">
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
                        {submissionStatus === 'online'
                          ? '✅ Mastery score synced directly to your cloud student profile.'
                          : '💾 Saved to local IndexedDB. Will sync automatically when network connects.'}
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
                className={`w-full min-h-[300px] sm:min-h-[340px] classroom-card p-6 sm:p-8 cursor-pointer transition-all duration-200 select-none flex flex-col justify-between border-2 ${
                  isFlipped
                    ? 'bg-brand-50/60 border-brand-300'
                    : 'bg-white border-slate-300 hover:border-brand-400'
                }`}
                aria-label={`Flashcard ${cardIndex + 1} of ${totalCards}. Tap to flip.`}
              >
                {/* Card Top Pill */}
                <div className="flex items-center justify-between text-xs font-semibold text-slate-700 mb-4">
                  <span className="px-2.5 py-1 rounded-md bg-slate-100 text-slate-700">
                    Card {cardIndex + 1} of {totalCards}
                  </span>
                  <span className="flex items-center gap-1 text-brand-700">
                    <RotateCw className="w-3.5 h-3.5" />
                    <span>{isFlipped ? 'Answer Side (Tap to see concept)' : 'Tap or Space to Flip'}</span>
                  </span>
                </div>

                {/* Card Body (Front vs Back) */}
                <div className="py-6 text-center">
                  {!isFlipped ? (
                    <div>
                      <span className="inline-block px-3 py-1 bg-brand-100 text-brand-800 rounded-full text-xs font-bold uppercase tracking-wider mb-3">
                        Concept / Question
                      </span>
                      <h3 className="text-xl sm:text-2xl font-bold text-slate-900 leading-snug max-w-xl mx-auto">
                        {currentCard.front}
                      </h3>
                    </div>
                  ) : (
                    <div>
                      <span className="inline-block px-3 py-1 bg-emerald-100 text-emerald-800 rounded-full text-xs font-bold uppercase tracking-wider mb-3">
                        Textbook Explanation
                      </span>
                      <p className="text-base sm:text-lg text-slate-800 font-medium leading-relaxed max-w-xl mx-auto">
                        {currentCard.back}
                      </p>
                      {currentCard.page_number && (
                        <div className="mt-4 inline-flex items-center gap-1.5 px-2.5 py-1 bg-white rounded-md border border-slate-200 text-xs text-slate-600">
                          <BookOpen className="w-3.5 h-3.5 text-brand-600" />
                          <span>
                            {currentCard.chapter_title || 'NCERT Class 7 Science'}, Page {currentCard.page_number}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Card Footer */}
                <div className="pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-700">
                  <span>Topic: {selectedTopic.title}</span>
                  {masteredCards.has(cardIndex) && (
                    <span className="text-emerald-700 font-bold flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" />
                      <span>Marked Mastered</span>
                    </span>
                  )}
                </div>
              </div>

              {/* Deck Navigation & Mastery Action Buttons */}
              <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-3">
                {/* Prev / Next controls (Min 44px) */}
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={() => {
                      setIsFlipped(false);
                      setCardIndex((prev) => Math.max(0, prev - 1));
                    }}
                    disabled={cardIndex === 0}
                    className="btn-touch flex-1 sm:flex-initial px-4 py-2 border border-slate-300 disabled:opacity-40 rounded-xl bg-white text-slate-800 font-semibold text-xs flex items-center justify-center gap-1"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    <span>Previous</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsFlipped(false);
                      setCardIndex((prev) => Math.min(totalCards - 1, prev + 1));
                    }}
                    disabled={cardIndex === totalCards - 1}
                    className="btn-touch flex-1 sm:flex-initial px-4 py-2 border border-slate-300 disabled:opacity-40 rounded-xl bg-white text-slate-800 font-semibold text-xs flex items-center justify-center gap-1"
                  >
                    <span>Next</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

                {/* Mastery Toggles */}
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={() => toggleCardMastered(cardIndex)}
                    className={`btn-touch flex-1 sm:flex-initial px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                      masteredCards.has(cardIndex)
                        ? 'bg-emerald-600 text-white'
                        : 'bg-emerald-50 text-emerald-800 border border-emerald-300 hover:bg-emerald-100'
                    }`}
                  >
                    <Check className="w-4 h-4" />
                    <span>{masteredCards.has(cardIndex) ? 'Mastered' : 'Mark as Mastered'}</span>
                  </button>
                </div>
              </div>

              {/* Visual Deck Progress Bar */}
              <div className="mt-6 classroom-card p-4">
                <div className="flex justify-between text-xs font-medium text-slate-700 mb-1.5">
                  <span>Deck Review Progress</span>
                  <span className="font-bold text-slate-900">
                    {masteredCards.size} of {totalCards} cards mastered
                  </span>
                </div>
                <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                    style={{ width: `${(masteredCards.size / totalCards) * 100}%` }}
                  />
                </div>
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
