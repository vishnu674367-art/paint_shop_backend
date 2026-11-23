const router = require("express").Router();
const { pool } = require("../config/db");
const { authenticate, requireRoles } = require("../middleware/auth");
router.use(authenticate, requireRoles("manager", "accountant"));

// Sales totals grouped by date within an optional date range.
router.get("/sales", async (req, res) => {
  const { from, to } = req.query;
  if ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to))) {
    return res.status(400).json({ success: false, message: "Dates must use YYYY-MM-DD format" });
  }
  try {
    const clauses = [], params = [];
    if (from) { clauses.push("sale_date >= ?"); params.push(from); }
    if (to) { clauses.push("sale_date <= ?"); params.push(to); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const [rows] = await pool.query(
      `SELECT sale_date, COUNT(*) invoice_count, COALESCE(SUM(total_amount),0) total_sales,
              COALESCE(SUM(paid_amount),0) collected, COALESCE(SUM(balance_amount),0) outstanding
       FROM sales ${where} GROUP BY sale_date ORDER BY sale_date DESC LIMIT 366`, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: "Unable to load sales report" });
  }
});

router.get("/purchases", async (req, res) => {
  const { from, to } = req.query;
  if ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to))) {
    return res.status(400).json({ success: false, message: "Dates must use YYYY-MM-DD format" });
  }
  try {
    const clauses = [], params = [];
    if (from) { clauses.push("purchase_date >= ?"); params.push(from); }
    if (to) { clauses.push("purchase_date <= ?"); params.push(to); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const [rows] = await pool.query(
      `SELECT purchase_date, COUNT(*) purchase_count, COALESCE(SUM(total_amount),0) total_purchases
       FROM purchases ${where} GROUP BY purchase_date ORDER BY purchase_date DESC LIMIT 366`, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: "Unable to load purchase report" });
  }
});

router.get("/stock", async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, product_name, sku, stock_qty, reorder_level, unit,
              CASE WHEN stock_qty <= reorder_level THEN 'Low Stock' ELSE 'In Stock' END AS stock_status
       FROM products ORDER BY stock_qty ASC LIMIT 1000`);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: "Unable to load stock report" });
  }
});

router.get("/expenses", async (req, res) => {
  const { from, to } = req.query;
  if ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to))) {
    return res.status(400).json({ success: false, message: "Dates must use YYYY-MM-DD format" });
  }
  try {
    const clauses = [], params = [];
    if (from) { clauses.push("expense_date >= ?"); params.push(from); }
    if (to) { clauses.push("expense_date <= ?"); params.push(to); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const [rows] = await pool.query(
      `SELECT expense_date, category, COUNT(*) expense_count, COALESCE(SUM(amount),0) total_expenses
       FROM expenses ${where} GROUP BY expense_date, category ORDER BY expense_date DESC LIMIT 1000`, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: "Unable to load expense report" });
  }
});

module.exports = router;
