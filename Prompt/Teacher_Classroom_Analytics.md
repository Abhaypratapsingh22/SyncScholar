### CONTEXT & PRE-FLIGHT MANDATE
Read `AGENTS.md` before coding. Keep queries clean, efficient, and well-commented without adding unapproved packages.

### OBJECTIVE
Create the Teacher Dashboard backend aggregation endpoints that summarize multi-grade classroom performance and produce a "Classroom Weak-Spot Heatmap" from student mastery records and quiz error tags.

### STEP-BY-STEP INSTRUCTIONS
1. Classroom Weak-Spot Heatmap Aggregation (`GET /api/teacher/heatmap`):
   - Protected by `authorizeRoles('teacher')`. Filters students by the teacher's `school_id` and optional `grade_level` / `subject` query params.
   - Build a clean MongoDB Aggregation Pipeline over `users` and `quiz_attempts` that groups by `learning_objective_id` and `grade_level` to compute:
     - `total_students_assessed`
     - `average_mastery_score`
     - `struggling_student_count` (`mastery_score < 0.50`)
     - `top_misconception_tags` (top 3 most frequent `incorrect_question_tags`)
   - Sort results so the most critical weak spots (`struggling_student_count` descending, `average_mastery_score` ascending) appear at the top for immediate blackboard review.
2. Struggling Students Drill-Down (`GET /api/teacher/objectives/:objectiveId/students`):
   - Returns the list of students in that school needing prerequisite remediation on a specific learning objective, along with their last attempt score and timestamp.

### CONSTRAINTS
- Run aggregations directly inside MongoDB rather than pulling all student documents into Node.js memory.

### VERIFICATION / DEFINITION OF DONE
- Show sample JSON output of `GET /api/teacher/heatmap` across a multi-grade (Grades 6, 7, 8) school cohort.