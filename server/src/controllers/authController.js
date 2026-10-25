/**
 * @file authController.js
 * @description Authentication controllers for SyncScholar.
 * Handles student and teacher registration, credential verification, and identity retrieval.
 * Optimized for shared, low-bandwidth school devices with compact payloads and consistent error schemas.
 */

import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import { generateToken } from '../utils/token.js';

/**
 * POST /api/auth/register
 * Registers a new Student or Teacher account with role-specific profile validation.
 * 
 * - Student requirements: name, password, school_id, current_grade (1-12), and (roll_number OR email).
 * - Teacher requirements: name, password, school_id, assigned_grades ([1-12]), and (email OR roll_number).
 */
export async function register(req, res) {
  try {
    const {
      name,
      password,
      school_id,
      role = 'student',
      email,
      roll_number,
      current_grade,
      assigned_grades,
      preferred_language = 'en',
    } = req.body;

    // 1. Core mandatory fields
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Full name is required.' });
    }

    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password is required and must be at least 6 characters long.',
      });
    }

    if (!school_id || typeof school_id !== 'string' || !school_id.trim()) {
      return res.status(400).json({
        success: false,
        message: 'School ID is required for multi-tenant classroom partitioning.',
      });
    }

    if (!role || typeof role !== 'string' || !role.trim()) {
      return res.status(400).json({
        success: false,
        message: "Role is required and must be a string ('student' or 'teacher').",
      });
    }

    const normalizedRole = role.toLowerCase().trim();
    if (!['student', 'teacher'].includes(normalizedRole)) {
      return res.status(400).json({
        success: false,
        message: "Invalid role specified. Role must be 'student' or 'teacher'.",
      });
    }

    if (email !== undefined && email !== null && (typeof email !== 'string' || !email.trim())) {
      return res.status(400).json({
        success: false,
        message: 'email must be a valid non-empty string when provided.',
      });
    }

    if (roll_number !== undefined && roll_number !== null && (typeof roll_number !== 'string' || !roll_number.trim())) {
      return res.status(400).json({
        success: false,
        message: 'roll_number must be a valid non-empty string when provided.',
      });
    }

    // 2. Role-specific validation
    let parsedCurrentGrade = null;
    let parsedAssignedGrades = [];

    if (normalizedRole === 'student') {
      const numGrade = Number(current_grade);
      if (current_grade === undefined || current_grade === null || !Number.isInteger(numGrade)) {
        return res.status(400).json({
          success: false,
          message: 'current_grade must be an integer between 1 and 12.',
        });
      }

      parsedCurrentGrade = numGrade;
      if (parsedCurrentGrade < 1 || parsedCurrentGrade > 12) {
        return res.status(400).json({
          success: false,
          message: 'current_grade must be an integer between 1 and 12.',
        });
      }

      if (!roll_number && !email) {
        return res.status(400).json({
          success: false,
          message: 'Students must provide either a roll_number or an email address.',
        });
      }
    } else if (normalizedRole === 'teacher') {
      if (!Array.isArray(assigned_grades) || assigned_grades.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'assigned_grades array with at least one grade (1-12) is required for teacher registration.',
        });
      }

      parsedAssignedGrades = assigned_grades.map(Number);
      const invalidGrade = parsedAssignedGrades.find((g) => isNaN(g) || g < 1 || g > 12);
      if (invalidGrade !== undefined) {
        return res.status(400).json({
          success: false,
          message: 'All entries in assigned_grades must be valid grade numbers between 1 and 12.',
        });
      }

      if (!email && !roll_number) {
        return res.status(400).json({
          success: false,
          message: 'Teachers must provide an email address (or employee roll/ID).',
        });
      }
    }

    // 3. Duplicate checks
    const trimmedSchoolId = school_id.trim();
    const cleanEmail = email ? email.trim().toLowerCase() : undefined;
    const cleanRollNumber = roll_number ? roll_number.trim().toUpperCase() : undefined;

    if (cleanEmail) {
      const existingEmail = await User.findOne({ email: cleanEmail });
      if (existingEmail) {
        return res.status(409).json({
          success: false,
          message: `An account with email '${cleanEmail}' is already registered.`,
        });
      }
    }

    if (cleanRollNumber) {
      const existingRoll = await User.findOne({
        school_id: trimmedSchoolId,
        roll_number: cleanRollNumber,
      });
      if (existingRoll) {
        return res.status(409).json({
          success: false,
          message: `Roll number '${cleanRollNumber}' is already registered in school '${trimmedSchoolId}'.`,
        });
      }
    }

    // 4. Secure Password Hashing
    const saltRounds = 10;
    const password_hash = await bcrypt.hash(password, saltRounds);

    // 5. User Document Creation
    const newUser = await User.create({
      name: name.trim(),
      email: cleanEmail,
      roll_number: cleanRollNumber,
      password_hash,
      role: normalizedRole,
      school_id: trimmedSchoolId,
      current_grade: parsedCurrentGrade,
      assigned_grades: parsedAssignedGrades,
      preferred_language: preferred_language ? preferred_language.trim().toLowerCase() : 'en',
    });

    // 6. Generate lightweight session token for offline PWA caching
    const token = generateToken(newUser);

    return res.status(201).json({
      success: true,
      message: `${normalizedRole.charAt(0).toUpperCase() + normalizedRole.slice(1)} account created successfully.`,
      token,
      user: {
        id: newUser._id,
        name: newUser.name,
        role: newUser.role,
        school_id: newUser.school_id,
        email: newUser.email || null,
        roll_number: newUser.roll_number || null,
        current_grade: newUser.current_grade ?? null,
        assigned_grades: newUser.assigned_grades || [],
        preferred_language: newUser.preferred_language,
      },
    });
  } catch (error) {
    console.error('Registration Error:', error);
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'An account with this email or roll number already exists.',
      });
    }
    return res.status(500).json({
      success: false,
      message: 'Failed to complete registration due to an internal server error.',
    });
  }
}

/**
 * POST /api/auth/login
 * Authenticates students and teachers using email OR roll number + school_id.
 * Returns a signed JWT token and essential profile payload for client-side storage.
 */
export async function login(req, res) {
  try {
    const { identifier, email, roll_number, school_id, password } = req.body;

    if (!password) {
      return res.status(400).json({
        success: false,
        message: 'Password is required to log in.',
      });
    }

    if (identifier !== undefined && identifier !== null && typeof identifier !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'identifier must be a string if provided.',
      });
    }

    if (email !== undefined && email !== null && typeof email !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'email must be a string if provided.',
      });
    }

    if (roll_number !== undefined && roll_number !== null && typeof roll_number !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'roll_number must be a string if provided.',
      });
    }

    if (school_id !== undefined && school_id !== null && typeof school_id !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'school_id must be a string if provided.',
      });
    }

    const candidateId = (identifier || email || roll_number || '').trim();
    if (!candidateId) {
      return res.status(400).json({
        success: false,
        message: 'Please provide your email address or school roll number.',
      });
    }

    // Resolve user by email (contains '@') or school roll number
    let user;
    if (candidateId.includes('@')) {
      user = await User.findOne({ email: candidateId.toLowerCase() });
    } else {
      const query = { roll_number: candidateId.toUpperCase() };
      if (school_id && school_id.trim()) {
        query.school_id = school_id.trim();
      }

      const matchedUsers = await User.find(query);
      if (matchedUsers.length === 1) {
        user = matchedUsers[0];
      } else if (matchedUsers.length > 1) {
        return res.status(400).json({
          success: false,
          message: 'Multiple student accounts found with this roll number. Please specify school_id.',
        });
      }
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials.',
      });
    }

    // Verify password against stored bcrypt hash
    const isPasswordValid = await user.matchPassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials.',
      });
    }

    // Generate JWT token
    const token = generateToken(user);

    return res.status(200).json({
      success: true,
      message: 'Authentication successful.',
      token,
      user: {
        id: user._id,
        name: user.name,
        role: user.role,
        school_id: user.school_id,
        email: user.email || null,
        roll_number: user.roll_number || null,
        current_grade: user.current_grade ?? null,
        assigned_grades: user.assigned_grades || [],
        preferred_language: user.preferred_language,
      },
    });
  } catch (error) {
    console.error('Login Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Login failed due to an internal server error.',
    });
  }
}

/**
 * GET /api/auth/me
 * Retrieves current authenticated user metadata verified from JWT token.
 * Used by PWA on startup to re-validate session state.
 */
export async function getMe(req, res) {
  try {
    const user = req.user;

    return res.status(200).json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        role: user.role,
        school_id: user.school_id,
        email: user.email || null,
        roll_number: user.roll_number || null,
        current_grade: user.current_grade ?? null,
        assigned_grades: user.assigned_grades || [],
        preferred_language: user.preferred_language,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error('GetMe Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve profile data.',
    });
  }
}

export default {
  register,
  login,
  getMe,
};
