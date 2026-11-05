/**
 * @file textFormatter.jsx
 * @description Sanitizes raw LaTeX mathematical syntax and renders student-friendly,
 * high-contrast curriculum explanations for K-12 students.
 */

import React from 'react';

/**
 * Strips confusing LaTeX math commands and converts them into natural textbook language.
 * Examples:
 *   "($v = \text{frequency} \times \text{wavelength}$)" -> "(v = Frequency × Wavelength)"
 *   "$T = \frac{1}{\nu}$" -> "T = 1 / Frequency"
 *   "$344\text{ m s}^{-1}$" -> "344 m/s"
 *   "$3.44\text{ m}$" -> "3.44 m"
 */
export function cleanStudentMath(text) {
  if (!text || typeof text !== 'string') return '';
  let cleaned = text;

  // 1. Replace \text{...} with inside content
  cleaned = cleaned.replace(/\\text\s*\{([^}]*)\}/g, '$1');

  // 2. Replace \frac{a}{b} -> a / b
  cleaned = cleaned.replace(/\\frac\s*\{([^}]*)\}\s*\{([^}]*)\}/g, '$1 / $2');

  // 3. Replace common LaTeX math symbols
  cleaned = cleaned.replace(/\\times/g, '×');
  cleaned = cleaned.replace(/\\cdot/g, '·');
  cleaned = cleaned.replace(/\\div/g, '÷');
  cleaned = cleaned.replace(/\\pm/g, '±');
  cleaned = cleaned.replace(/\\leq/g, '≤');
  cleaned = cleaned.replace(/\\geq/g, '≥');
  cleaned = cleaned.replace(/\\neq/g, '≠');
  cleaned = cleaned.replace(/\\approx/g, '≈');

  // 4. Replace Greek symbols with readable names or standard symbols
  cleaned = cleaned.replace(/\\nu\b/g, 'Frequency (ν)');
  cleaned = cleaned.replace(/\\lambda\b/g, 'Wavelength (λ)');
  cleaned = cleaned.replace(/\\mu\b/g, 'μ');
  cleaned = cleaned.replace(/\\theta\b/g, 'θ');
  cleaned = cleaned.replace(/\\pi\b/g, 'π');
  cleaned = cleaned.replace(/\\Delta\b/g, 'Δ');

  // 5. Clean up units notation: m s^{-1} -> m/s, m s^-1 -> m/s, etc.
  cleaned = cleaned.replace(/m\s*s\^\{-1\}/gi, 'm/s');
  cleaned = cleaned.replace(/m\s*s\^-1/gi, 'm/s');
  cleaned = cleaned.replace(/m\s*s\^\{-2\}/gi, 'm/s²');
  cleaned = cleaned.replace(/m\s*s\^-2/gi, 'm/s²');
  cleaned = cleaned.replace(/m\/s\^2/gi, 'm/s²');
  cleaned = cleaned.replace(/\^\{-1\}/g, '⁻¹');
  cleaned = cleaned.replace(/\^\{2\}/g, '²');
  cleaned = cleaned.replace(/\^\{3\}/g, '³');
  cleaned = cleaned.replace(/\^2/g, '²');
  cleaned = cleaned.replace(/\^3/g, '³');

  // 6. Scientific notation powers and chemical subscripts (Priority 7)
  cleaned = cleaned.replace(/10\^23/g, '10²³');
  cleaned = cleaned.replace(/10\^-11/g, '10⁻¹¹');
  cleaned = cleaned.replace(/10\^8/g, '10⁸');

  cleaned = cleaned.replace(/\bH2O\b/g, 'H₂O');
  cleaned = cleaned.replace(/\bCO2\b/g, 'CO₂');
  cleaned = cleaned.replace(/\bO2\b/g, 'O₂');
  cleaned = cleaned.replace(/\bN2\b/g, 'N₂');
  cleaned = cleaned.replace(/\bH2\b/g, 'H₂');
  cleaned = cleaned.replace(/\bHNO3\b/g, 'HNO₃');
  cleaned = cleaned.replace(/Ca\(OH\)2/g, 'Ca(OH)₂');
  cleaned = cleaned.replace(/Mg\(OH\)2/g, 'Mg(OH)₂');
  cleaned = cleaned.replace(/\bSO4\b/g, 'SO₄');
  cleaned = cleaned.replace(/\bNH3\b/g, 'NH₃');
  cleaned = cleaned.replace(/_2\b/g, '₂');
  cleaned = cleaned.replace(/_3\b/g, '₃');
  cleaned = cleaned.replace(/_4\b/g, '₄');

  // 7. Clean up remaining LaTeX commands
  cleaned = cleaned.replace(/\\left|\\right/g, '');
  cleaned = cleaned.replace(/\\[,;!]/g, ' ');

  // 8. Strip math delimiters $ and $$
  cleaned = cleaned.replace(/\$\$([^$]+)\$\$/g, '$1');
  cleaned = cleaned.replace(/\$([^$]+)\$/g, '$1');

  // 9. Simplify double parentheses and spaces
  cleaned = cleaned.replace(/\(\s*\(([^()]+)\)\s*\)/g, '($1)');
  cleaned = cleaned.replace(/[ \t]+/g, ' ');

  return cleaned.trim();
}

/**
 * Parses bold markdown markers (**text**) into <strong> JSX tags.
 */
export function renderInlineStyles(text) {
  if (!text) return null;
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={idx} className="font-bold text-slate-900">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}

/**
 * Renders paragraphs and lists cleanly with student-friendly formatting.
 */
export function FormattedStudentContent({ content, className = '' }) {
  if (!content) return null;
  const cleaned = cleanStudentMath(content);
  const paragraphs = cleaned.split('\n\n');

  return (
    <div className={`space-y-2.5 ${className}`}>
      {paragraphs.map((para, pIdx) => {
        const lines = para.split('\n');
        return (
          <div key={pIdx} className="leading-relaxed text-sm text-slate-800">
            {lines.map((line, lIdx) => {
              const trimmed = line.trim();
              if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
                return (
                  <div key={lIdx} className="flex items-start gap-2 ml-2 my-1">
                    <span className="text-brand-600 font-bold">•</span>
                    <span>{renderInlineStyles(trimmed.slice(2))}</span>
                  </div>
                );
              }
              const isNumbered = /^[0-9]+\.\s+/.test(trimmed);
              if (isNumbered) {
                const numberMatch = trimmed.match(/^([0-9]+\.)\s+(.*)/);
                return (
                  <div key={lIdx} className="flex items-start gap-2 ml-1 my-1">
                    <span className="font-bold text-brand-700 min-w-[20px]">{numberMatch[1]}</span>
                    <span>{renderInlineStyles(numberMatch[2])}</span>
                  </div>
                );
              }
              return (
                <p key={lIdx} className={lIdx > 0 ? 'mt-1' : ''}>
                  {renderInlineStyles(line)}
                </p>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

