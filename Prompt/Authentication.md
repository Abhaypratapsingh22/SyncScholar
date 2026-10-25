### CONTEXT & PRE-FLIGHT MANDATE
Read `AGENTS.md` first and follow every architectural and dependency rule strictly. Ask permission before installing any authentication libraries (such as `bcryptjs` or `jsonwebtoken`).

### OBJECTIVE
Implement lightweight, secure authentication and role-based profile management for Students and Teachers optimized for shared low-resource school devices.

### STEP-BY-STEP INSTRUCTIONS
1. Library Gate: Propose password hashing (`bcryptjs`) and token signing (`jsonwebtoken`) libraries (or Node's built-in `crypto.scrypt` if zero-dependency is cleaner), explain why, and ask permission before installing.
2. Auth Controllers & Routes (`POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`):
   - Support simple registration/login for both `student` (requires `current_grade`, `school_id`) and `teacher` (requires `school_id`, `assigned_grades`).
   - Return a lightweight JWT payload and essential profile metadata so the PWA can cache user grade and role locally for offline views.
3. Role Middleware (`server/src/middlewares/authMiddleware.js`):
   - `protect`: Verifies JWT token and attaches `req.user`.
   - `authorizeRoles(...roles)`: Cleanly restricts teacher-only analytics routes vs. student learning routes.
4. Student Profile Endpoint (`GET /api/student/profile`):
   - Returns the student's `current_grade`, `concept_mastery` summary, and recent learning progress in a compact JSON payload suitable for 2G/3G networks.

### CONSTRAINTS
- Keep payloads small and error responses consistent (`{ success: false, message: "..." }`).
- Write clear docstrings explaining the auth flow.

### VERIFICATION / DEFINITION OF DONE
- Provide sample `curl` or REST client requests to register a Grade 7 Student and a Teacher in the same `school_id` and test role-protected endpoints.