
const router = require("express").Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const { pool } = require("../config/db");
const { authenticate } = require("../middleware/auth");

// ========================================
// ADMIN / STAFF LOGIN
// ========================================

router.post("/login", async (req, res) => {
  try {
    // Get username or email, and password
    const rawIdentifier = String(
      req.body?.identifier || req.body?.email || req.body?.username || ""
    ).trim();

    const password = req.body?.password;

    // Validate input
    if (!rawIdentifier || !password || typeof password !== "string") {
      return res.status(400).json({
        success: false,
        message: "Please enter username/email and password"
      });
    }

    const identifier = rawIdentifier.toLowerCase();

    // Check JWT configuration
    if (!process.env.JWT_SECRET) {
      console.error("JWT_SECRET is missing");

      return res.status(500).json({
        success: false,
        message: "Server authentication configuration error"
      });
    }

    // Find user from MySQL database by either email OR username (case-insensitive)
    const [users] = await pool.query(
      `SELECT id, name, email, password_hash, role, permissions
       FROM users
       WHERE LOWER(email) = ? OR LOWER(name) = ?
       LIMIT 1`,
      [identifier, identifier]
    );

    // User not found
    if (!users || users.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Incorrect email or password"
      });
    }

    const user = users[0];

    // Check password hash
    if (!user.password_hash) {
      console.error("Password hash is missing for user:", user.id);

      return res.status(500).json({
        success: false,
        message: "User account configuration error"
      });
    }

    // Compare password with database hash
    const passwordMatch = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        message: "Incorrect email or password"
      });
    }

    // Validate user role
    const userRole = String(user.role || "staff").toLowerCase().trim();
    if (!userRole) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to access this system"
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        permissions: user.permissions
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "8h"
      }
    );

    // Successful login response
    return res.status(200).json({
      success: true,
      message: "Login successful",
      token: token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        permissions: user.permissions
      }
    });

  } catch (error) {
    console.error("Login Error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to login. Please try again."
    });
  }
});


// ========================================
// GET LOGGED-IN USER
// ========================================

router.get("/me", authenticate, (req, res) => {
  return res.status(200).json({
    success: true,
    user: req.user
  });
});

module.exports = router;
