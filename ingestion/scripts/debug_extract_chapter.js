/**
 * Debug Extraction Diagnostic Script
 * Tests extraction, header/footer stripping, and low-density filtering on iemh101.pdf
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pdf from 'pdf-parse/lib/pdf-parse.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INGESTION_ROOT = path.resolve(__dirname, '..');

const pdfPath = path.join(INGESTION_ROOT, 'raw_pdfs', 'Ncert_class_9_part1', 'iemh101.pdf');
const chapterTitle = 'Orienting Yourself: The Use of Coordinates';

function stripHeadersAndFootersCurrent(pageText, title = '') {
  let text = pageText;
  text = text.replace(/\r\n/g, '\n');
  text = text.replace(/^\s*\d+\s+[A-Za-z\s]+?\|\s*Grade\s*\d+\s*\|\s*Part\s*[A-Za-z0-9]+/gim, '');
  if (title && title.trim().length > 3) {
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp('^\\s*\\d+\\s+' + escaped, 'gim'), '');
    text = text.replace(new RegExp(escaped + '\\s*$', 'gim'), '');
  }
  text = text.replace(/Rationalised\s*\d{4}-\d{2}/gi, '');
  text = text.replace(/Not to be republished/gi, '');
  text = text.replace(/Reprint\s*\d{4}/gi, '');
  text = text.replace(/^\s*\d+\s*\n/, '');
  text = text.replace(/\n\s*\d+\s*$/, '');
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
  return text;
}

async function debugExtract() {
  console.log(`Analyzing: ${pdfPath}`);
  const buffer = fs.readFileSync(pdfPath);
  const pages = [];

  const options = {
    pagerender: async function (pageData) {
      const pageNumber = pageData.pageNumber;
      const textContent = await pageData.getTextContent();
      pages.push({ pageNumber, items: textContent.items });
      return '';
    }
  };

  await pdf(buffer, options);
  pages.sort((a, b) => a.pageNumber - b.pageNumber);

  console.log(`\nAuditing pages 1 to 10 of iemh101.pdf:`);
  for (const page of pages.slice(0, 10)) {
    console.log(`\n=================== Page ${page.pageNumber} ===================`);
    // Filter margin items (top header and bottom indesign footer)
    // Page height is ~706. Top margin > 635, bottom margin < 35
    const marginItems = page.items.filter(i => i.str && (i.transform[5] > 635 || i.transform[5] < 35));
    const bodyItems = page.items.filter(i => i.str && i.transform[5] >= 35 && i.transform[5] <= 635);

    console.log(`Total text spans: ${page.items.length} (Body: ${bodyItems.length}, Margins: ${marginItems.length})`);
    if (marginItems.length > 0) {
      console.log(`  Header/Footer dropped: "${marginItems.map(i => i.str).join(' ')}"`);
    }

    // Check X coordinates distribution in bodyItems to detect columns
    const nonSpaceBody = bodyItems.filter(i => i.str.trim().length > 0);
    const xs = nonSpaceBody.map(i => i.transform[4]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    console.log(`  X bounds: [${minX.toFixed(1)}, ${maxX.toFixed(1)}]`);

    // Let's test smart line clustering
    // Cluster items within Y threshold (e.g. 4.0 points)
    const lines = [];
    for (const item of nonSpaceBody) {
      const y = item.transform[5];
      const x = item.transform[4];
      const str = item.str;
      let matchedLine = lines.find(l => Math.abs(l.y - y) <= 4.0);
      if (!matchedLine) {
        matchedLine = { y, items: [] };
        lines.push(matchedLine);
      }
      matchedLine.items.push({ str, x, y, width: item.width || 0 });
    }

    // Sort lines by Y descending (top to bottom)
    lines.sort((a, b) => b.y - a.y);

    const formattedLines = [];
    for (const line of lines) {
      // Sort items on the same line left to right by X
      line.items.sort((a, b) => a.x - b.x);
      // Join items with a space if there is a gap between consecutive items
      let lineText = '';
      let prevRight = null;
      for (const it of line.items) {
        if (prevRight !== null) {
          // If items are adjacent (gap < 2 pt), don't insert extra space; otherwise add space
          const gap = it.x - prevRight;
          if (gap > 2.0 && !lineText.endsWith(' ') && !it.str.startsWith(' ')) {
            lineText += ' ';
          }
        }
        lineText += it.str;
        prevRight = it.x + (it.width || (it.str.length * 5));
      }
      formattedLines.push(lineText.trim());
    }

    const fullPageText = formattedLines.filter(Boolean).join('\n');
    const wordCount = fullPageText.split(/\s+/).filter(Boolean).length;
    console.log(`  Reconstructed Word Count: ${wordCount}`);
    console.log(`  Preview (first 4 lines):\n    ${formattedLines.slice(0, 4).join('\n    ')}`);
  }
}

function extractPageBlocks(items, pageHeight = 706) {
  // 1. Filter out margin items (headers and footers)
  const bodyItems = items.filter(i => {
    if (!i.str || !i.str.trim()) return false;
    const y = i.transform[5];
    if (y < 40 || y > pageHeight - 55) return false;
    return true;
  });

  if (bodyItems.length === 0) return '';

  // 2. Cluster items into horizontal lines (Y tolerance 4.0pt)
  const lines = [];
  for (const item of bodyItems) {
    const y = item.transform[5];
    const x = item.transform[4];
    const width = item.width || (item.str.length * 5);
    let matchedLine = lines.find(l => Math.abs(l.y - y) <= 4.0);
    if (!matchedLine) {
      matchedLine = { y, items: [] };
      lines.push(matchedLine);
    }
    matchedLine.items.push({ str: item.str, x, y, width });
  }

  // Sort lines top to bottom (descending Y)
  lines.sort((a, b) => b.y - a.y);

  // Format each line and compute line bounds
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    let lineText = '';
    let prevRight = null;
    for (const it of line.items) {
      if (prevRight !== null) {
        const gap = it.x - prevRight;
        if (gap > 2.0 && !lineText.endsWith(' ') && !it.str.startsWith(' ')) {
          lineText += ' ';
        }
      }
      lineText += it.str;
      prevRight = it.x + it.width;
    }
    line.text = lineText.trim();
    line.minX = Math.min(...line.items.map(it => it.x));
    line.maxX = Math.max(...line.items.map(it => it.x + it.width));
  }

  // Filter out any lines that ended up empty
  const validLines = lines.filter(l => l.text.length > 0);
  if (validLines.length === 0) return '';

  // 3. Segment into horizontal bands: Full-width vs 2-Column bands
  // Midpoint between columns is around X=255.
  // Full-width line: minX < 230 && maxX > 280
  // Left-column line: maxX <= 265
  // Right-column line: minX >= 245
  const bands = [];
  let currentBand = null;

  for (const line of validLines) {
    const isFullWidth = (line.minX < 230 && line.maxX > 280);
    const lineType = isFullWidth ? 'full' : (line.minX >= 245 ? 'right' : 'left');

    if (!currentBand) {
      currentBand = { type: isFullWidth ? 'full' : 'multi', lines: [line] };
    } else if (isFullWidth) {
      if (currentBand.type === 'full') {
        currentBand.lines.push(line);
      } else {
        bands.push(currentBand);
        currentBand = { type: 'full', lines: [line] };
      }
    } else {
      // multi-column line
      if (currentBand.type === 'multi') {
        currentBand.lines.push(line);
      } else {
        bands.push(currentBand);
        currentBand = { type: 'multi', lines: [line] };
      }
    }
  }
  if (currentBand) bands.push(currentBand);

  // 4. Assemble text band-by-band
  const outputLines = [];
  for (const band of bands) {
    if (band.type === 'full') {
      for (const line of band.lines) {
        outputLines.push(line.text);
      }
    } else {
      // Multi-column band: separate into left and right lines
      const leftLines = band.lines.filter(l => l.minX < 245);
      const rightLines = band.lines.filter(l => l.minX >= 245);

      // If both left and right columns have substantive content, read left then right
      if (leftLines.length > 0 && rightLines.length > 0) {
        // Read left column top-to-bottom
        for (const line of leftLines) outputLines.push(line.text);
        // Read right column top-to-bottom
        for (const line of rightLines) outputLines.push(line.text);
      } else {
        // Just single column in this band
        for (const line of band.lines) outputLines.push(line.text);
      }
    }
  }

  return outputLines.join('\n');
}

async function testExtractionAlgorithm() {
  const testCases = [
    { file: 'iemh101.pdf', pages: [1, 2, 6, 13] },
    { file: 'iemh102.pdf', pages: [3, 4, 11] }
  ];

  for (const tc of testCases) {
    const fullPath = path.join(INGESTION_ROOT, 'raw_pdfs', 'Ncert_class_9_part1', tc.file);
    const buf = fs.readFileSync(fullPath);
    await pdf(buf, {
      pagerender: async (p) => {
        if (tc.pages.includes(p.pageNumber)) {
          const content = await p.getTextContent();
          const extracted = extractPageBlocks(content.items, p.pageInfo?.view?.[3] || 706);
          console.log(`\n=================== ${tc.file} Page ${p.pageNumber} ===================`);
          console.log(`Lines: ${extracted.split('\n').length} | Words: ${extracted.split(/\s+/).filter(Boolean).length}`);
          console.log(extracted.slice(0, 400) + '...\n');
        }
        return '';
      }
    });
  }
}

function mathAwareChunkText(text, targetWords = 300, minWords = 15, maxWords = 380, overlapWords = 40) {
  const rawParagraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  if (rawParagraphs.length === 0) {
    const trimmed = text.trim();
    if (!trimmed) return [];
    rawParagraphs.push(trimmed);
  }

  // Merge Example statements with their immediate Solution blocks into atomic blocks
  const blocks = [];
  for (let i = 0; i < rawParagraphs.length; i++) {
    const p = rawParagraphs[i];
    const isExampleHeader = /^(?:Example|Activity|Theorem|Definition)\s+\d+/i.test(p);
    const nextIsSolution = i + 1 < rawParagraphs.length && /^Solution\b/i.test(rawParagraphs[i + 1]);

    if (isExampleHeader && nextIsSolution) {
      blocks.push(p + '\n\n' + rawParagraphs[i + 1]);
      i++; // Skip the solution paragraph since it's merged
    } else {
      blocks.push(p);
    }
  }

  const wordCount = (str) => str.split(/\s+/).filter(Boolean).length;
  const totalWords = wordCount(text);

  // If the total text is within reasonable chunk bounds, return as 1 chunk
  if (totalWords <= maxWords) {
    return totalWords >= minWords ? [text.trim()] : [];
  }

  const chunks = [];
  let currentBlocks = [];
  let currentWords = 0;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const bWords = wordCount(block);

    // If a single block exceeds maxWords, split it at sentence boundaries
    if (bWords > maxWords) {
      if (currentBlocks.length > 0) {
        chunks.push(currentBlocks.join('\n\n'));
        currentBlocks = [];
        currentWords = 0;
      }
      // Split large block by sentences
      const sentences = block.match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g) || [block];
      let subChunkWords = [];
      for (const sent of sentences) {
        const sWords = sent.split(/\s+/).filter(Boolean);
        if (subChunkWords.length + sWords.length > targetWords && subChunkWords.length >= 100) {
          chunks.push(subChunkWords.join(' '));
          // Overlap last overlapWords
          subChunkWords = subChunkWords.slice(-overlapWords).concat(sWords);
        } else {
          subChunkWords.push(...sWords);
        }
      }
      if (subChunkWords.length >= minWords) {
        chunks.push(subChunkWords.join(' '));
      }
      continue;
    }

    if (currentWords + bWords > maxWords && currentWords >= 200) {
      chunks.push(currentBlocks.join('\n\n'));
      // Overlap: retain last block if it's small, or take tail words
      const lastBlock = currentBlocks[currentBlocks.length - 1];
      const lastWords = wordCount(lastBlock);
      if (lastWords <= overlapWords + 10) {
        currentBlocks = [lastBlock, block];
        currentWords = lastWords + bWords;
      } else {
        const tailWords = lastBlock.split(/\s+/).filter(Boolean).slice(-overlapWords).join(' ');
        currentBlocks = [tailWords, block];
        currentWords = overlapWords + bWords;
      }
    } else {
      currentBlocks.push(block);
      currentWords += bWords;
    }
  }

  if (currentBlocks.length > 0) {
    const lastChunkText = currentBlocks.join('\n\n');
    if (wordCount(lastChunkText) >= minWords) {
      chunks.push(lastChunkText);
    } else if (chunks.length > 0) {
      chunks[chunks.length - 1] += '\n\n' + lastChunkText;
    }
  }

  return chunks;
}

async function testFullChapter1() {
  console.log('\n======================================================');
  console.log('🧪 Testing Full Extraction & Chunking on iemh101.pdf');
  console.log('======================================================');
  const fullPath = path.join(INGESTION_ROOT, 'raw_pdfs', 'Ncert_class_9_part1', 'iemh101.pdf');
  const buf = fs.readFileSync(fullPath);

  const pages = [];
  await pdf(buf, {
    pagerender: async (p) => {
      const tc = await p.getTextContent();
      const extracted = extractPageBlocks(tc.items, p.pageInfo?.view?.[3] || 706);
      pages.push({ pageNumber: p.pageNumber, text: extracted });
      return '';
    }
  });

  pages.sort((a, b) => a.pageNumber - b.pageNumber);

  let totalChunks = 0;
  for (const page of pages) {
    // Strip headers/footers
    let cleaned = stripHeadersAndFootersCurrent(page.text, chapterTitle);
    const words = cleaned.split(/\s+/).filter(Boolean).length;
    if (words < 15) {
      console.log(`Page ${page.pageNumber}: Skipped (words: ${words} < 15)`);
      continue;
    }
    const chunks = mathAwareChunkText(cleaned);
    totalChunks += chunks.length;
    console.log(`Page ${page.pageNumber}: Words: ${words} -> ${chunks.length} chunk(s)`);
  }

  console.log(`\n🎉 Total Chapter 1 Chunks generated: ${totalChunks}`);
}

testFullChapter1().catch(console.error);





