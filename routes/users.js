const router = require("express").Router();
const bcrypt = require("bcryptjs");
const { pool } = require("../config/db");
const { authenticate, adminOnly } = require("../middleware/auth");

router.use(authenticate, adminOnly);

const VALID_ROLES = [
  "admin",
  "manager",
  "cashier",
  "stock_manager",
  "accountant",
  "sales",
  "staff"
];

// List staff/admin accounts without exposing password hashes.
router.get("/", async (_req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id,name,email,role,permissions,created_at FROM users ORDER BY id DESC"
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: "Unable to load users" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id,name,email,role,permissions,created_at FROM users WHERE id=?",
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: "User not found" });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: "Unable to load user" });
  }
});

router.post("/", async (req, res) => {
  const { name, email, password, role = "staff", permissions } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ success: false, message: "name, email and password are required" });
  }
  const normalizedRole = String(role).toLowerCase().trim();
  if (!VALID_ROLES.includes(normalizedRole)) {
    return res.status(400).json({ success: false, message: `role must be one of: ${VALID_ROLES.join(", ")}` });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ success: false, message: "password must contain at least 6 characters" });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const serializedPerms = permissions ? (typeof permissions === "string" ? permissions : JSON.stringify(permissions)) : null;
    const [result] = await pool.query(
      "INSERT INTO users (name,email,password_hash,role,permissions) VALUES (?,?,?,?,?)",
      [String(name).trim(), String(email).trim().toLowerCase(), hash, normalizedRole, serializedPerms]
    );
    res.status(201).json({ success: true, message: "User created", id: result.insertId });
  } catch (err) {
    const duplicate = err.code === "ER_DUP_ENTRY";
    res.status(duplicate ? 409 : 500).json({
      success: false, message: duplicate ? "Email already exists" : "Unable to create user"
    });
  }
});

router.put("/:id", async (req, res) => {
  const { name, email, password, role, permissions } = req.body || {};
  const fields = [];
  const values = [];
  if (name !== undefined) { fields.push("name=?"); values.push(String(name).trim()); }
  if (email !== undefined) { fields.push("email=?"); values.push(String(email).trim().toLowerCase()); }
  if (role !== undefined) {
    const normalizedRole = String(role).toLowerCase().trim();
    if (!VALID_ROLES.includes(normalizedRole)) {
      return res.status(400).json({ success: false, message: `role must be one of: ${VALID_ROLES.join(", ")}` });
    }
    fields.push("role=?"); values.push(normalizedRole);
  }
  if (permissions !== undefined) {
    const serializedPerms = permissions ? (typeof permissions === "string" ? permissions : JSON.stringify(permissions)) : null;
    fields.push("permissions=?"); values.push(serializedPerms);
  }
  if (password !== undefined) {
    if (String(password).length < 6) return res.status(400).json({ success: false, message: "password must contain at least 6 characters" });
    fields.push("password_hash=?"); values.push(await bcrypt.hash(password, 10));
  }
  if (!fields.length) return res.status(400).json({ success: false, message: "Provide at least one field to update" });
  try {
    values.push(req.params.id);
    const [result] = await pool.query(`UPDATE users SET ${fields.join(",")} WHERE id=?`, values);
    if (!result.affectedRows) return res.status(404).json({ success: false, message: "User not found" });
    res.json({ success: true, message: "User updated" });
  } catch (err) {
    res.status(err.code === "ER_DUP_ENTRY" ? 409 : 500).json({ success: false, message: err.code === "ER_DUP_ENTRY" ? "Email already exists" : "Unable to update user" });
  }
});

router.delete("/:id", async (req, res) => {
  if (Number(req.params.id) === Number(req.user.id)) {
    return res.status(400).json({ success: false, message: "You cannot delete your own account" });
  }
  try {
    const [result] = await pool.query("DELETE FROM users WHERE id=?", [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ success: false, message: "User not found" });
    res.json({ success: true, message: "User deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Unable to delete user" });
  }
});

module.exports = router;
