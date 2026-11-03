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
 * 7. Clear offline state communication: pauses live RAG generation while highlighting cached decks
 */

import React, { useState, useEffect, useRef } from 'react';
import { api } from '../services/api.js';
import { cacheTutorHistory, getCachedTutorHistory } from '../db/offlineDb.js';
import { EmptyState } from './EmptyState.jsx';
import { FormattedStudentContent, cleanStudentMath, renderInlineStyles } from '../utils/textFormatter.jsx';
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
  WifiOff,
  ArrowRight,
  BookMarked,
} from 'lucide-react';

const SUGGESTIONS_BY_GRADE = {
  9: [
    {
      subject: 'Science',
      loId: 'SCI-09-SOUN-01',
      text: 'A source produces a sound wave of wavelength 3.44 m. If the wave travels with a speed of 344 m s-1 find its time period.',
    },
    {
      subject: 'Science',
      loId: 'SCI-09-CELL-01',
      text: 'Why is the plasma membrane called a selectively permeable membrane?',
    },
    {
      subject: 'Science',
      loId: 'SCI-09-MOTI-01',
      text: 'What is the difference between distance and displacement in rectilinear motion?',
    },
  ],
  7: [
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
  ],
};

const CURRICULUM_STARTER_FALLBACKS = [
  {
    grade_level: 9,
    pattern: /speed.*distance.*time|car.*travels.*120.*metres/i,
    answer: "To calculate the speed of an object, we use the standard curriculum kinematic formula from Chapter 4 (Describing Motion Around Us):\n\n1. **Given Quantities:**\n   - Distance (d) = 120 metres\n   - Time interval (t) = 10 seconds\n\n2. **Curriculum Formula:**\n   Speed = Distance / Time\n\n3. **Step-by-Step Calculation:**\n   Speed = 120 m / 10 s = 12 m/s",
    socratic_follow_up: "Now try this: If a cyclist travels a distance of 180 metres in 15 seconds, what is their speed in m/s?",
    detected_learning_objective_id: 'SCI-09-MOTI-01',
    citations: [
      {
        source_curriculum: 'NCERT',
        grade_level: 9,
        subject: 'Science',
        chapter_title: 'Describing Motion Around Us',
        page_number: 45,
        source_url: 'https://ncert.nic.in/textbook.php?jesc1=4-13',
        text_excerpt: 'The rate of motion of an object is given by the distance travelled by the object per unit time. The SI unit of speed is metre per second (m/s).',
      },
    ],
  },
  {
    grade_level: 9,
    pattern: /sound.*wave.*wavelength|wavelength.*3\.44|speed.*344.*time\s*period/i,
    answer: "To solve this NCERT Sound Wave exercise question step-by-step, let's list the given quantities from Chapter 10 (Sound Waves):\n\n1. **Given Quantities:**\n   - Wavelength (λ) = 3.44 m\n   - Speed of the sound wave (v) = 344 m/s\n\n2. **Curriculum Formula:**\n   Recall the wave relationship connecting wave speed, frequency, and wavelength:\n   Speed = Frequency × Wavelength  (or  v = Frequency × λ)\n\n   Since Time Period (T) is inversely related to frequency (Time Period = 1 / Frequency), substituting gives:\n   Speed = Wavelength / Time Period  ==>  Time Period = Wavelength / Speed  (T = λ / v)\n\n3. **Step-by-Step Calculation:**\n   Time Period = 3.44 m / 344 m/s = 0.01 seconds (or 10 ms).",
    socratic_follow_up: "If another sound wave travels at 340 m/s with a wavelength of 1.7 m, what will its time period be?",
    detected_learning_objective_id: 'SCI-09-SOUN-01',
    citations: [
      {
        source_curriculum: 'NCERT',
        grade_level: 9,
        subject: 'Science',
        chapter_title: 'Sound Waves: Characteristics and Applications',
        page_number: 189,
        source_url: 'https://ncert.nic.in/textbook.php?jesc1=10-13',
        text_excerpt: 'The speed of sound is defined as the distance which a point on a wave, such as a compression or a rarefaction, travels per unit time. Speed, v = distance / time = λ / T. Since 1/T = ν, v = λ ν.',
      },
    ],
  },
  {
    grade_level: 9,
    pattern: /plasma.*membrane.*selectively.*permeable|selectively.*permeable.*membrane/i,
    answer: "The plasma membrane is called a **selectively permeable membrane** because it permits and regulates the entry and exit of select materials in and out of the cell, while preventing the passage of other unwanted substances.\n\nGases like carbon dioxide (CO₂) and oxygen (O₂) move across through simple **diffusion**, whereas water molecules move following their concentration gradient via **osmosis**.",
    socratic_follow_up: "If an animal cell is placed in a concentrated sugar or salt solution (hypertonic medium), what will happen to the water inside the cell according to osmosis?",
    detected_learning_objective_id: 'SCI-09-CELL-01',
    citations: [
      {
        source_curriculum: 'NCERT',
        grade_level: 9,
        subject: 'Science',
        chapter_title: 'Cell - The Fundamental Unit of Life',
        page_number: 21,
        source_url: 'https://ncert.nic.in/textbook.php?jesc1=2-13',
        text_excerpt: 'The plasma membrane allows or permits the entry and exit of some materials in and out of the cell. It also prevents movement of some other materials. The cell membrane, therefore, is called a selectively permeable membrane.',
      },
    ],
  },
  {
    grade_level: 7,
    pattern: /metal.*spoon|spoon.*cold/i,
    answer: "Great observation! In your science curriculum, heat always flows from a hotter object to a colder object through a process called **conduction**.\n\nOn a cold winter morning, your hand is warmer than both spoons. Metal is a **good conductor of heat**, meaning it rapidly conducts heat away from your fingertips, making your skin register cold almost instantly. In contrast, wood is an **insulator (poor conductor)**, which transfers heat much more slowly.",
    socratic_follow_up: "Since wood is an insulator that slows down heat transfer, what do you think would happen to the warmth in your hand if you held a wooden spoon compared to a plastic or silver one?",
    detected_learning_objective_id: 'SCI-07-HEAT-04',
    citations: [
      {
        source_curriculum: 'NCERT',
        grade_level: 7,
        subject: 'Science',
        chapter_title: 'Heat',
        page_number: 41,
        source_url: 'https://ncert.nic.in/textbook/pdf/gesc104.pdf',
        text_excerpt: 'The materials which allow heat to pass through them easily are conductors of heat, for example, aluminium, iron and copper. The materials which do not allow heat to pass through them easily are poor conductors of heat such as plastic and wood. Poor conductors are known as insulators.',
      },
    ],
  },
  {
    grade_level: 7,
    pattern: /conduction.*solids|heat.*transfer.*solids/i,
    answer: "In solids, heat is transferred by **conduction**. Conduction is the process by which heat is transferred from the hotter end to the colder end of an object without the bulk movement of the solid itself.\n\nWhen one end of a metal rod is heated, the particles near that end vibrate faster and pass thermal energy to neighboring particles, until heat spreads through the entire solid.",
    socratic_follow_up: "Why do cooking pans usually have handles made of wood or heat-resistant plastic instead of metal?",
    detected_learning_objective_id: 'SCI-07-HEAT-04',
    citations: [
      {
        source_curriculum: 'NCERT',
        grade_level: 7,
        subject: 'Science',
        chapter_title: 'Heat',
        page_number: 40,
        source_url: 'https://ncert.nic.in/textbook/pdf/gesc104.pdf',
        text_excerpt: 'The process by which heat is transferred from the hotter end to the colder end of an object is known as conduction. In solids, generally, the heat is transferred by the process of conduction.',
      },
    ],
  },
  {
    grade_level: 7,
    pattern: /photosynthesis|raw material.*plants/i,
    answer: "Green plants synthesize their food through **photosynthesis** using four key raw materials:\n1. **Chlorophyll**: Green pigment in leaves that traps light energy.\n2. **Sunlight**: The ultimate source of energy for the reaction.\n3. **Carbon dioxide**: Taken in from air through tiny pores called stomata.\n4. **Water and minerals**: Absorbed from the soil by roots and transported to leaves.",
    socratic_follow_up: "If a potted green plant is placed in a dark cupboard with sufficient water and soil nutrients, can it produce food? Which essential component is missing?",
    detected_learning_objective_id: 'SCI-07-NUTR-01',
    citations: [
      {
        source_curriculum: 'NCERT',
        grade_level: 7,
        subject: 'Science',
        chapter_title: 'Nutrition in Plants',
        page_number: 2,
        source_url: 'https://ncert.nic.in/textbook/pdf/gesc101.pdf',
        text_excerpt: 'Water, chlorophyll, carbon dioxide and sunlight are necessary to carry out the process of Photosynthesis. The solar energy is captured by the leaves and stored in the plant in the form of food.',
      },
    ],
  },
];

export function TutorView({ student, syncState, onSelectTab, onUpdateGrade }) {
  const [selectedGrade, setSelectedGrade] = useState(student?.current_grade || 9);
  const [subject, setSubject] = useState('Science');
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState([]);
  const [errorMessage, setErrorMessage] = useState(null);
  const [expandedCitations, setExpandedCitations] = useState({});
  const chatEndRef = useRef(null);

  useEffect(() => {
    if (student?.current_grade) {
      setSelectedGrade(Number(student.current_grade));
    }
  }, [student?.current_grade]);

  const handleGradeChange = (val) => {
    const newGrade = Number(val);
    setSelectedGrade(newGrade);
    if (onUpdateGrade) {
      onUpdateGrade(newGrade);
    }
  };

  const isOnline = syncState?.isOnline ?? true;

  // Load cached messages from IndexedDB for offline persistence
  useEffect(() => {
    async function loadHistory() {
      try {
        const studentId = student?.id || student?._id || 'guest';
        const cached = await getCachedTutorHistory(studentId, 15);
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
              content: cleanStudentMath(item.answer),
              socratic_follow_up: cleanStudentMath(item.socratic_follow_up),
              remediation_mode_active: item.remediation_mode_active,
              citations: item.citations || [],
              timestamp: item.created_at,
            });
          });
          setMessages(initialMessages);
        } else {
          setMessages([]);
        }
      } catch (err) {
        console.warn('Could not load cached tutor messages:', err);
      }
    }
    loadHistory();
  }, [student]);

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

  const handleAsk = async (prefilledText = null) => {
    const textToAsk = (prefilledText || question).trim();
    if (!textToAsk || loading) return;

    if (!isOnline) {
      // If offline, check if student asked a starter curriculum question with offline fallback (BUG SS-008)
      const offlineStarter = CURRICULUM_STARTER_FALLBACKS.find(
        (f) => f.pattern.test(textToAsk) && (!f.grade_level || f.grade_level === selectedGrade)
      );
      if (offlineStarter) {
        const userMsg = {
          id: `msg-${Date.now()}-u`,
          role: 'student',
          content: textToAsk,
          subject,
          timestamp: new Date().toISOString(),
        };
        const tutorMsg = {
          id: `msg-${Date.now()}-a`,
          role: 'tutor',
          content: offlineStarter.answer,
          socratic_follow_up: offlineStarter.socratic_follow_up,
          remediation_mode_active: false,
          citations: offlineStarter.citations,
          out_of_syllabus: false,
          rate_limited_fallback: true,
          timestamp: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, userMsg, tutorMsg]);
        setQuestion('');
        setErrorMessage(null);
        await cacheTutorHistory({
          student_id: student?.id || 'guest',
          subject,
          question: textToAsk,
          answer: offlineStarter.answer,
          socratic_follow_up: offlineStarter.socratic_follow_up,
          remediation_mode_active: false,
          citations: offlineStarter.citations,
        });
        return;
      }

      // If navigator is strictly offline (no browser connection), inform user
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setErrorMessage(
          'Live Socratic RAG tutoring requires internet connection. Please review cached discussions below or practice offline quizzes and flashcards.'
        );
        return;
      }
    }

    setErrorMessage(null);
    setLoading(true);

    // Add student query to active thread immediately
    const userMsg = {
      id: `msg-${Date.now()}-u`,
      role: 'student',
      content: textToAsk,
      subject,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setQuestion('');

    try {
      // Format recent turns as conversation history for multi-turn context (BUG SS-004)
      const historyPayload = messages.slice(-6).map((m) => ({
        role: m.role === 'student' ? 'student' : 'tutor',
        content: m.content || '',
      }));

      const response = await api.askTutor({
        question: textToAsk,
        subject,
        grade: selectedGrade,
        conversationHistory: historyPayload,
      });

      if (response?.success && response?.data) {
        const data = response.data;
        const formattedAnswer = cleanStudentMath(data.answer);
        const formattedFollowUp = cleanStudentMath(data.socratic_follow_up);

        const tutorMsg = {
          id: `msg-${Date.now()}-a`,
          role: 'tutor',
          content: formattedAnswer,
          socratic_follow_up: formattedFollowUp,
          remediation_mode_active: Boolean(data.remediation_mode_active),
          citations: data.citations || [],
          out_of_syllabus: Boolean(data.metadata?.out_of_syllabus),
          rate_limited_fallback: Boolean(data.metadata?.rate_limited_fallback),
          timestamp: new Date().toISOString(),
        };

        setMessages((prev) => [...prev, tutorMsg]);

        // Cache in Dexie for offline reading
        await cacheTutorHistory({
          student_id: student?.id || 'guest',
          subject,
          question: textToAsk,
          answer: formattedAnswer,
          socratic_follow_up: formattedFollowUp,
          remediation_mode_active: data.remediation_mode_active,
          citations: data.citations,
        });
      } else {
        throw new Error(response?.message || 'Could not synthesize answer from curriculum.');
      }
    } catch (err) {
      console.error('Tutor ask error:', err);
      // Check for starter curriculum fallback if network failed or quota exceeded
      const matchedStarter = CURRICULUM_STARTER_FALLBACKS.find(
        (f) => f.pattern.test(textToAsk) && (!f.grade_level || f.grade_level === selectedGrade)
      );
      if (matchedStarter) {
        const fallbackMsg = {
          id: `msg-${Date.now()}-a`,
          role: 'tutor',
          content: matchedStarter.answer,
          socratic_follow_up: matchedStarter.socratic_follow_up,
          remediation_mode_active: false,
          citations: matchedStarter.citations,
          out_of_syllabus: false,
          rate_limited_fallback: true,
          timestamp: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, fallbackMsg]);
        await cacheTutorHistory({
          student_id: student?.id || 'guest',
          subject,
          question: textToAsk,
          answer: matchedStarter.answer,
          socratic_follow_up: matchedStarter.socratic_follow_up,
          remediation_mode_active: false,
          citations: matchedStarter.citations,
        });
      } else {
        let userFriendlyError = err.message || 'Failed to connect to tutor service.';
        if (err.isOffline || !isOnline) {
          userFriendlyError = 'You are offline. Showing cached answers from your local storage.';
        }
        setErrorMessage(userFriendlyError);
      }
    } finally {
      setLoading(false);
    }
  };

  const currentSuggestions = SUGGESTIONS_BY_GRADE[selectedGrade] || SUGGESTIONS_BY_GRADE[9];

  return (
    <div className="max-w-4xl mx-auto py-6 px-4 sm:px-6">
      {/* Subject & Grade Selector Context Header */}
      <div className="classroom-card p-4 mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Class / Grade Selector Dropdown */}
          <div className="flex items-center gap-2">
            <label htmlFor="grade-select" className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1">
              <BookOpen className="w-3.5 h-3.5 text-brand-600" />
              Class:
            </label>
            <select
              id="grade-select"
              value={selectedGrade}
              onChange={(e) => handleGradeChange(e.target.value)}
              className="min-h-[44px] px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm font-semibold text-slate-900 focus:ring-2 focus:ring-brand-500"
            >
              <option value={6}>Class 6</option>
              <option value={7}>Class 7</option>
              <option value={8}>Class 8</option>
              <option value={9}>Class 9 (NCERT 2024-25)</option>
              <option value={10}>Class 10</option>
            </select>
          </div>

          {/* Subject Selector */}
          <div className="flex items-center gap-2">
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
        </div>

        <div className="flex items-center gap-2 text-xs font-medium text-slate-700">
          <span className={`w-2.5 h-2.5 rounded-full ${isOnline ? 'bg-emerald-500 ring-2 ring-emerald-200' : 'bg-amber-500 ring-2 ring-amber-200'}`} />
          <span>Curriculum Class {selectedGrade} Grounded</span>
        </div>
      </div>

      {/* Prominent Offline Guard & Classroom Redirection Banner */}
      {!isOnline && (
        <div className="mb-5 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-amber-100 rounded-lg text-amber-800 flex-shrink-0 mt-0.5">
              <WifiOff className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm tracking-tight">Offline Mode — Live AI Answering Paused</h3>
              <p className="text-xs text-amber-800 mt-0.5">
                New doubt generation requires internet. You can still review past conversations and textbook citations below, or study cached materials offline.
              </p>
            </div>
          </div>
          {onSelectTab && (
            <button
              type="button"
              onClick={() => onSelectTab('assessment')}
              className="btn-touch px-3.5 py-1.5 text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-lg shadow-sm flex items-center gap-1.5 whitespace-nowrap self-stretch sm:self-auto justify-center"
            >
              <BookMarked className="w-3.5 h-3.5" />
              <span>Practice Offline Decks</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>
      )}

      {/* Suggested Topic Starter Chips (Quick 1-tap Doubts) */}
      {messages.length === 0 && (
        <div className="mb-6">
          <p className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-brand-600" />
            <span>Class {selectedGrade} Starter Doubts (Tap to Ask)</span>
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {currentSuggestions.map((s, idx) => (
              <button
                key={idx}
                type="button"
                disabled={!isOnline}
                onClick={() => handleAsk(s.text)}
                className={`btn-touch p-3 text-left bg-white border border-slate-200 rounded-xl transition-all shadow-xs ${isOnline
                    ? 'hover:border-brand-500 hover:bg-brand-50/30'
                    : 'opacity-60 cursor-not-allowed bg-slate-50'
                  }`}
              >
                <span className="text-xs font-semibold text-brand-700 block mb-1">
                  {s.subject} • {s.loId}
                </span>
                <span className="text-xs text-slate-800 line-clamp-2">{s.text}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Chat Thread Container */}
      <div className="classroom-card p-4 sm:p-6 mb-4 min-h-[360px] max-h-[560px] overflow-y-auto space-y-4">
        {messages.length === 0 ? (
          <EmptyState
            iconType="books"
            title={`Socratic Class ${selectedGrade} Doubt Tutor`}
            description="Ask any question from your NCERT or OpenStax textbook. The tutor guides you step-by-step with analogies and citations without giving away test answers."
            onAction={isOnline && currentSuggestions[0] ? () => handleAsk(currentSuggestions[0].text) : null}
            actionText={isOnline && currentSuggestions[0] ? `Try: ${currentSuggestions[0].text.slice(0, 42)}...` : null}
          />
        ) : (
          messages.map((msg, idx) => {
            if (msg.role === 'student') {
              return (
                <div key={msg.id || idx} className="flex justify-end">
                  <div className="max-w-[85%] sm:max-w-[75%] bg-brand-600 text-white rounded-2xl rounded-tr-xs px-4 py-3 shadow-sm">
                    <p className="text-sm font-medium leading-relaxed">{msg.content}</p>
                    <div className="mt-1 text-[10px] text-brand-100 text-right">
                      {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                    </div>
                  </div>
                </div>
              );
            }

            // Tutor Response Card
            return (
              <div key={msg.id || idx} className="flex flex-col gap-3 max-w-[95%] sm:max-w-[88%]">
                <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-xs p-4 sm:p-5 shadow-xs space-y-3">
                  {/* Socratic Anti-Cheating & Prerequisite Badges */}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-brand-100 text-brand-800 rounded-md">
                      Socratic Tutor
                    </span>

                    {msg.remediation_mode_active && (
                      <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-900 rounded-md flex items-center gap-1 border border-amber-300">
                        <Layers className="w-3 h-3 text-amber-700" />
                        Prerequisite Mode (Bridging Foundational Concept)
                      </span>
                    )}

                    {msg.out_of_syllabus && (
                      <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700 rounded-md">
                        Curriculum Boundary
                      </span>
                    )}

                    {msg.rate_limited_fallback && (
                      <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-900 rounded-md flex items-center gap-1 border border-emerald-300">
                        <BookMarked className="w-3 h-3 text-emerald-700" />
                        Curriculum Grounded (Low-Bandwidth Mode)
                      </span>
                    )}
                  </div>

                  {/* Socratic Explanation Body */}
                  <FormattedStudentContent content={msg.content} />

                  {/* Socratic Guiding Hint Box */}
                  {msg.socratic_follow_up && (
                    <div className="p-3 bg-indigo-50/70 border border-indigo-200 rounded-xl">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-900 mb-1">
                        <HelpCircle className="w-4 h-4 text-indigo-600" />
                        <span>Socratic Reflection Hint</span>
                      </div>
                      <div className="text-xs text-indigo-950 font-medium leading-normal">
                        {renderInlineStyles(cleanStudentMath(msg.socratic_follow_up))}
                      </div>
                    </div>
                  )}

                  {/* Expandable NCERT / OpenStax Textbook Citations */}
                  {msg.citations && msg.citations.length > 0 && (
                    <div className="pt-2 border-t border-slate-100 space-y-2">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1">
                        <BookOpen className="w-3.5 h-3.5 text-brand-600" />
                        <span>Curriculum Source Citations ({msg.citations.length})</span>
                      </p>

                      <div className="space-y-1.5">
                        {msg.citations.map((citation, cIdx) => {
                          const isExpanded = expandedCitations[`${idx}-${cIdx}`];
                          return (
                            <div
                              key={cIdx}
                              className="border border-slate-200 rounded-lg overflow-hidden text-xs bg-slate-50/50"
                            >
                              <button
                                type="button"
                                onClick={() => toggleCitation(idx, cIdx)}
                                className="w-full px-3 py-2 text-left flex items-center justify-between hover:bg-slate-100 transition-colors"
                              >
                                <span className="font-semibold text-slate-800 truncate">
                                  {citation.source_curriculum || 'NCERT'} Class {citation.grade_level || selectedGrade || 9} {citation.subject || 'Science'} — {citation.chapter_title || `Chapter ${citation.chapter_number || '?'}`} (p. {citation.page_number || 'N/A'})
                                </span>
                                {isExpanded ? (
                                  <ChevronUp className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                                ) : (
                                  <ChevronDown className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                                )}
                              </button>

                              {isExpanded && (
                                <div className="px-3 pb-3 pt-1 border-t border-slate-200 bg-white space-y-2">
                                  <p className="text-xs text-slate-700 italic border-l-2 border-brand-500 pl-2">
                                    "{citation.text_excerpt || citation.text || 'Textbook excerpt grounded for this topic.'}"
                                  </p>
                                  {citation.source_url && (
                                    <a
                                      href={citation.source_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-700 hover:text-brand-800 hover:underline"
                                    >
                                      <span>View Official Textbook Source</span>
                                      <ExternalLink className="w-3 h-3" />
                                    </a>
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
            );
          })
        )}

        {/* Loading Skeleton during RAG retrieval */}
        {loading && (
          <div className="flex flex-col gap-2 max-w-[85%] animate-pulse">
            <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-xs p-4 space-y-2.5 shadow-xs">
              <div className="h-3 bg-slate-200 rounded w-28" />
              <div className="h-3.5 bg-slate-200 rounded w-full" />
              <div className="h-3.5 bg-slate-200 rounded w-5/6" />
              <div className="h-3.5 bg-slate-200 rounded w-3/4" />
              <div className="pt-2 flex items-center gap-2">
                <div className="h-3 bg-brand-100 rounded w-36" />
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
          placeholder={
            loading
              ? 'Synthesizing grounded explanation...'
              : isOnline
              ? `Ask your ${subject} doubt (e.g. "Why does ice melt faster in warm water?")...`
              : `Ask your ${subject} doubt (offline mode available)...`
          }
          className="flex-1 min-h-[44px] px-3.5 py-2 text-sm sm:text-base bg-transparent border-0 focus:ring-0 text-slate-900 placeholder:text-slate-400 outline-none disabled:cursor-not-allowed"
          disabled={loading}
          maxLength={1000}
        />

        <button
          type="submit"
          disabled={loading || !question.trim()}
          className="btn-touch px-4 py-2 bg-brand-600 hover:bg-brand-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold rounded-lg shadow-sm flex items-center gap-1.5 transition-all text-sm"
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
