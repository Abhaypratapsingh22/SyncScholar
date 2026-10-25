/**
 * @file api.js
 * @description Resilient API client for SyncScholar frontend.
 * Designed with low-bandwidth empathy: handles request timeouts, network dropouts,
 * offline fallbacks, and JWT authorization headers cleanly.
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

/**
 * Retrieves the current authentication token from localStorage.
 *
 * @returns {string|null}
 */
export function getAuthToken() {
  return localStorage.getItem('syncscholar_token') || null;
}

/**
 * Stores the authentication token into localStorage.
 *
 * @param {string} token
 */
export function setAuthToken(token) {
  if (token) {
    localStorage.setItem('syncscholar_token', token);
  } else {
    localStorage.removeItem('syncscholar_token');
  }
}

/**
 * Enhanced fetch wrapper with timeout and offline resilience.
 *
 * @param {string} endpoint - API path relative to base URL (e.g. '/tutor/ask')
 * @param {object} options - Standard fetch options
 * @param {number} timeoutMs - Timeout in ms (default 15000ms for slow 2G/3G)
 * @returns {Promise<any>}
 */
async function request(endpoint, options = {}, timeoutMs = 20000) {
  if (!navigator.onLine) {
    const error = new Error('You are currently offline. Switching to local classroom mode.');
    error.isOffline = true;
    throw error;
  }

  const token = getAuthToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const url = `${API_BASE_URL}${cleanEndpoint}`;

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const error = new Error(data?.message || `HTTP error ${response.status}`);
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError') {
      const timeoutError = new Error('Network request timed out. Classroom connection is very slow.');
      timeoutError.isTimeout = true;
      throw timeoutError;
    }

    if (!navigator.onLine || error.message?.includes('Failed to fetch')) {
      const offlineError = new Error('Unable to connect to server. Working in offline mode.');
      offlineError.isOffline = true;
      throw offlineError;
    }

    throw error;
  }
}

export const api = {
  // Authentication
  async login(credentials) {
    const res = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    });
    if (res.token) {
      setAuthToken(res.token);
    }
    return res;
  },

  async register(userData) {
    const res = await request('/auth/register', {
      method: 'POST',
      body: JSON.stringify(userData),
    });
    if (res.token) {
      setAuthToken(res.token);
    }
    return res;
  },

  async getMe() {
    return await request('/auth/me', { method: 'GET' });
  },

  // Student Profile & Mastery
  async getStudentProfile() {
    return await request('/student/profile', { method: 'GET' });
  },

  // Adaptive Socratic Doubt Tutor
  async askTutor({ question, subject = 'Science', learningObjectiveId = null }) {
    return await request('/tutor/ask', {
      method: 'POST',
      body: JSON.stringify({
        question,
        subject,
        learningObjectiveId,
      }),
    });
  },

  // Formative Assessments & Flashcards
  async generateAssessment({ subject, learning_objective_id, topic_query, grade_level }) {
    return await request('/assessments/generate', {
      method: 'POST',
      body: JSON.stringify({
        subject,
        learning_objective_id,
        topic_query,
        grade_level,
      }),
    });
  },

  async submitQuizAttempt(payload) {
    return await request('/assessments/submit', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async syncBatchAttempts(attempts) {
    return await request('/assessments/sync-batch', {
      method: 'POST',
      body: JSON.stringify({ attempts }),
    });
  },

  async getAssessmentHistory() {
    return await request('/assessments/history', { method: 'GET' });
  },
};

export default api;
