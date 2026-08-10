const students = [
  { id: 'stu-001', username: 'abc', age: 13, phone: '0771234567', attempts: 5, completed_attempts: 5, average_score: 62, best_score: 90, latest_attempt_at: '2026-08-10T08:45:00Z' },
  { id: 'stu-002', username: 'Nethmi', age: 15, phone: '0712345678', attempts: 4, completed_attempts: 4, average_score: 78, best_score: 100, latest_attempt_at: '2026-08-10T07:15:00Z' },
  { id: 'stu-003', username: 'Kasun', age: 16, phone: '0769876543', attempts: 3, completed_attempts: 3, average_score: 53, best_score: 70, latest_attempt_at: '2026-08-09T09:30:00Z' },
  { id: 'stu-004', username: 'Ayesha', age: 14, phone: '0754567890', attempts: 6, completed_attempts: 6, average_score: 84, best_score: 100, latest_attempt_at: '2026-08-09T06:20:00Z' },
]

const modules = [
  { module_name: 'Design_Thinking', module_title: 'Design Thinking', session_count: 2, students_attempted: 4, total_attempts: 8, average_score: 72, best_score: 100, latest_attempt_at: '2026-08-10T08:45:00Z' },
  { module_name: 'Entrepreneurial_Mindset', module_title: 'The Entrepreneurial Mindset', session_count: 2, students_attempted: 3, total_attempts: 5, average_score: 68, best_score: 90, latest_attempt_at: '2026-08-09T09:30:00Z' },
  { module_name: 'Understanding_Markets_Customers', module_title: 'Understanding Markets & Customers', session_count: 2, students_attempted: 2, total_attempts: 3, average_score: 79, best_score: 100, latest_attempt_at: '2026-08-08T11:00:00Z' },
]

const attempts = [
  { id: 'att-001', student_id: 'stu-001', username: 'abc', module_name: 'Design_Thinking', module_title: 'Design Thinking', session_name: 'Session 1', score: 20, correct_count: 2, total_questions: 10, status: 'completed', created_at: '2026-08-10T08:45:00Z' },
  { id: 'att-002', student_id: 'stu-002', username: 'Nethmi', module_name: 'Design_Thinking', module_title: 'Design Thinking', session_name: 'Session 1', score: 90, correct_count: 9, total_questions: 10, status: 'completed', created_at: '2026-08-10T07:15:00Z' },
  { id: 'att-003', student_id: 'stu-003', username: 'Kasun', module_name: 'Entrepreneurial_Mindset', module_title: 'The Entrepreneurial Mindset', session_name: 'Session 1', score: 60, correct_count: 6, total_questions: 10, status: 'completed', created_at: '2026-08-09T09:30:00Z' },
  { id: 'att-004', student_id: 'stu-004', username: 'Ayesha', module_name: 'Design_Thinking', module_title: 'Design Thinking', session_name: 'Session 2', score: 100, correct_count: 10, total_questions: 10, status: 'completed', created_at: '2026-08-09T06:20:00Z' },
]

const reviewQuestions = [
  {
    question_number: 1,
    question_text: 'How long should the POV/problem statement be?',
    option_a: 'One sentence', option_b: 'One paragraph', option_c: 'One page', option_d: 'As long as necessary',
    selected_option: 'C', correct_option: 'A', is_correct: false, difficulty: 'easy', topic: 'Problem statements',
  },
  {
    question_number: 2,
    question_text: 'Which stage comes after Define in Design Thinking?',
    option_a: 'Test', option_b: 'Empathise', option_c: 'Ideate', option_d: 'Prototype',
    selected_option: 'C', correct_option: 'C', is_correct: true, difficulty: 'easy', topic: 'Design Thinking stages',
  },
  {
    question_number: 3,
    question_text: 'During a silent prototype test, what should the builder do?',
    option_a: 'Explain every feature', option_b: 'Observe without helping', option_c: 'Defend the design', option_d: 'Tell the user what to click',
    selected_option: 'A', correct_option: 'B', is_correct: false, difficulty: 'medium', topic: 'Testing',
  },
]

export const demo = {
  dashboard: {
    total_students: 4,
    total_attempts: 18,
    completed_attempts: 18,
    average_score: 71,
    completion_rate: 100,
    recent_attempts: attempts,
    module_performance: modules,
    score_distribution: [
      { label: '0–39', count: 2 },
      { label: '40–59', count: 4 },
      { label: '60–79', count: 7 },
      { label: '80–100', count: 5 },
    ],
  },
  students,
  modules,
  attempts,
  student(id) {
    const profile = students.find((s) => s.id === id) || students[0]
    return {
      profile,
      summary: profile,
      module_stats: modules.map((m, i) => ({ ...m, attempts: Math.max(1, 3 - i), latest_score: [20, 70, 80][i], best_score: [90, 80, 100][i] })),
      attempts: attempts.filter((a) => a.student_id === profile.id),
    }
  },
  module(name) {
    const mod = modules.find((m) => m.module_name === name) || modules[0]
    return {
      module: mod,
      sessions: [
        { batch_id: `${mod.module_name}-s1`, session_name: 'Session 1', session_date: '2026-08-08', students_attempted: 4, total_attempts: 5, average_score: 69 },
        { batch_id: `${mod.module_name}-s2`, session_name: 'Session 2', session_date: '2026-08-15', students_attempted: 3, total_attempts: 3, average_score: 77 },
      ],
      hardest_questions: [
        { question_text: 'What makes a problem statement useful?', topic: 'Define', difficulty: 'medium', attempts: 8, incorrect_count: 5, incorrect_rate: 62.5 },
        { question_text: 'Why should a prototype test be silent?', topic: 'Test', difficulty: 'hard', attempts: 7, incorrect_count: 4, incorrect_rate: 57.1 },
      ],
    }
  },
  attempt(id) {
    const attempt = attempts.find((a) => a.id === id) || attempts[0]
    return {
      attempt,
      questions: reviewQuestions.map((q, i) => ({ ...q, question_number: i + 1 })),
    }
  },
}
