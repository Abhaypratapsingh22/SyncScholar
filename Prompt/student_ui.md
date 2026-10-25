### CONTEXT & PRE-FLIGHT MANDATE
STOP and read `AGENTS.md` carefully—especially the **UI Implementation Rules (VERY IMPORTANT)**, **Image Generation Rules**, and **Library Permission Gate**. Every visual and frontend decision must strictly obey those rules.

### OBJECTIVE
Build the clean, fast, accessible React + Tailwind CSS Student Workspace in `/client` optimized for low-bandwidth networks and low-end mobile/tablet screens.

### STEP-BY-STEP INSTRUCTIONS
1. Library Gate: Propose only essential frontend packages (e.g., `react-router-dom` and lightweight tree-shakeable SVG icons like `lucide-react`, or pure inline SVGs). Explain bundle size impact and ask for my explicit approval before installing.
2. Low-Bandwidth Design System & Layout:
   - High-contrast, sunlit-classroom-readable typography, clear spacing, touch-friendly tap targets (minimum 44px), and zero heavy background images, decorative carousels, or GPU-draining animations.
   - Follow `AGENTS.md` Image Rules strictly: use lightweight inline SVGs for empty states, subject badges, and status indicators—never unoptimized raster images.
   - Include a persistent top header bar featuring a clear **Network & Sync Status Pill** (`Online`, `Offline — Local Mode`, `Syncing Pending Attempts...`).
3. Student Views:
   - **Curriculum Doubt Tutor View:** Subject selector, clean chat thread, Socratic guiding hint callout box, a subtle badge when *Prerequisite Foundation Mode* is helping bridge an earlier grade concept, and expandable **NCERT/OpenStax Source Citation Cards** (showing Chapter, Grade, Page Number, and external textbook link).
   - **Practice Quiz & Flashcard Deck View:** Generates or loads a 3-question micro-quiz and swipe/tap-to-flip study flashcards, displaying immediate textbook-grounded explanations after each submission and visual mastery progress bars.

### CONSTRAINTS
- No bloated UI component libraries, heavy chart libraries, or external font waterfalls that block first contentful paint on slow connections.
- Keep components small, single-responsibility, and easy to read.

### VERIFICATION / DEFINITION OF DONE
- Verify responsive layout across mobile (360px) and tablet/desktop viewports and confirm clean API integration with `/api/tutor/ask` and `/api/assessments`.