/**
 * @file EmptyState.jsx
 * @description Lightweight, bandwidth-first empty state illustrations using inline SVGs.
 * Adheres strictly to AGENTS.md image rules: zero raster images, zero external font waterfalls.
 */

import React from 'react';

export function EmptyState({ title, description, actionText, onAction, iconType = 'books' }) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center max-w-md mx-auto my-6">
      <div className="w-20 h-20 mb-4 text-brand-600 bg-brand-50 rounded-2xl flex items-center justify-center border border-brand-100">
        {iconType === 'books' && (
          <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z" />
            <path d="M6 6h10" />
            <path d="M6 10h10" />
            <path d="M2 6v14a2 2 0 0 0 2 2h16" />
          </svg>
        )}
        {iconType === 'quiz' && (
          <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m9 11 3 3L22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
        )}
        {iconType === 'flashcards' && (
          <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect width="16" height="20" x="4" y="2" rx="2" />
            <line x1="8" x2="16" y1="6" y2="6" />
            <line x1="16" x2="16" y1="14" y2="18" />
            <path d="M16 10h.01" />
            <path d="M12 10h.01" />
            <path d="M8 10h.01" />
          </svg>
        )}
        {iconType === 'offline' && (
          <svg className="w-10 h-10 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="1" x2="23" y1="1" y2="23" />
            <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
            <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
            <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
            <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
            <line x1="12" x2="12.01" y1="20" y2="20" />
          </svg>
        )}
      </div>

      <h3 className="text-lg font-semibold text-slate-900 mb-1">{title}</h3>
      <p className="text-sm text-slate-600 mb-4 leading-relaxed">{description}</p>

      {actionText && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="btn-touch px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white font-medium shadow-sm transition-all text-sm"
        >
          {actionText}
        </button>
      )}
    </div>
  );
}

export default EmptyState;
