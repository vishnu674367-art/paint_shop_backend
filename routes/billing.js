const router = require("express").Router();
const crypto = require("crypto");
const { pool } = require("../config/db");
const { authenticate } = require("../middleware/auth");

router.use(authenticate);

const PAYMENT_METHODS = ["Cash", "UPI", "Card", "Bank Transfer", "Other"];
const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const isPositiveId = (value) => Number.isInteger(Number(value)) && Number(value) > 0;
const isValidDate = (value) => !value || /^\d{4}-\d{2}-\d{2}$/.test(String(value));

function createInvoiceNumber() {
  const date = new Date();
  const ymd = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  return `INV-${ymd}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

function fail(res, status, message) {
  return res.status(status).json({ success: false, message });
}

// Billing overview cards.
router.get("/summary", async (_req, res) => {
  try {
    const [[summary]] = await pool.query(`
      SELECT
        COUNT(*) AS totalInvoices,
        COALESCE(SUM(total_amount), 0) AS totalBilled,
        COALESCE(SUM(paid_amount), 0) AS totalCollected,
        COALESCE(SUM(GREATEST(0, total_amount - paid_amount)), 0) AS totalOutstanding,
        COALESCE(SUM(CASE WHEN payment_status='Paid' THEN 1 ELSE 0 END),0) AS paidInvoices,
        COALESCE(SUM(CASE WHEN payment_status='Partial' THEN 1 ELSE 0 END),0) AS partialInvoices,
        COALESCE(SUM(CASE WHEN payment_status='Unpaid' THEN 1 ELSE 0 END),0) AS unpaidInvoices
      FROM sales`);
    const [[today]] = await pool.query(`
      SELECT COUNT(*) AS todayInvoices, COALESCE(SUM(total_amount),0) AS todayBilled
      FROM sales WHERE sale_date = CURDATE()`);
    res.json({ success: true, data: { ...summary, ...today } });
  } catch (error) {
    console.error("Billing summary error:", error);
    fail(res, 500, "Unable to load billing summary");
  }
});

// Preview an invoice number. The final number is generated again when saving.
router.get("/next-invoice-number", (_req, res) => {
  res.json({ success: true, invoice_no: createInvoiceNumber() });
});

// Search and filter invoices.
router.get("/invoices", async (req, res) => {
  try {
    const { search = "", status = "", from = "", to = "" } = req.query;
    if (!isValidDate(from) || !isValidDate(to)) return fail(res, 400, "Dates must use YYYY-MM-DD format");
    const where = [];
    const params = [];
    if (search.trim()) {
      const term = `%${search.trim()}%`;
      where.push("(s.invoice_no LIKE ? OR c.name LIKE ? OR c.phone LIKE ?)");
      params.push(term, term, term);
    }
    if (["Paid", "Partial", "Unpaid"].includes(status)) {
      where.push("s.payment_status = ?");
      params.push(status);
    }
    if (from) { where.push("s.sale_date >= ?"); params.push(from); }
    if (to) { where.push("s.sale_date <= ?"); params.push(to); }
    const sqlWhere = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const [rows] = await pool.query(`
      SELECT s.id, s.invoice_no, s.customer_id, c.name AS customer_name,
             c.phone AS customer_phone, s.subtotal, s.discount, s.tax_amount,
             s.total_amount, s.paid_amount,
             GREATEST(0, s.total_amount - s.paid_amount) AS balance_amount,
             s.payment_method,
             s.payment_status, s.sale_date, s.created_at,
             COALESCE(it.items_count, 1) AS items_count,
             it.product_ids, it.category_ids,
             COALESCE(it.total_cost, s.total_amount * 0.75) AS total_cost
      FROM sales s
      LEFT JOIN customers c ON c.id=s.customer_id
      LEFT JOIN (
        SELECT sale_id,
               COUNT(*) AS items_count,
               GROUP_CONCAT(si.product_id) AS product_ids,
               GROUP_CONCAT(p.category_id) AS category_ids,
               SUM(si.quantity * COALESCE(NULLIF(p.cost_price, 0), si.unit_price * 0.75)) AS total_cost
        FROM sale_items si
        LEFT JOIN products p ON p.id = si.product_id
        GROUP BY sale_id
      ) it ON it.sale_id = s.id
      ${sqlWhere}
      ORDER BY s.id DESC LIMIT 1000`, params);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (error) {
    console.error("Invoice list error:", error);
    fail(res, 500, "Unable to load invoices");
  }
});

// Get one complete invoice, including its line items and payment history.
router.get("/invoices/:id", async (req, res) => {
  if (!isPositiveId(req.params.id)) return fail(res, 400, "Invalid invoice ID");
  try {
    const [sales] = await pool.query(`
      SELECT s.*, c.name AS customer_name, c.phone AS customer_phone,
             c.email AS customer_email, c.address AS customer_address
      FROM sales s LEFT JOIN customers c ON c.id=s.customer_id
      WHERE s.id=?`, [req.params.id]);
    if (!sales.length) return fail(res, 404, "Invoice not found");
    const [items] = await pool.query(`
      SELECT id, product_id, product_name, quantity, unit_price, line_total
      FROM sale_items WHERE sale_id=? ORDER BY id`, [req.params.id]);
    const [payments] = await pool.query(`
      SELECT id, amount, payment_method, reference_no, payment_date, notes
      FROM sale_payments WHERE sale_id=? ORDER BY id DESC`, [req.params.id]);
    const invoice = sales[0];
    const totalAmount = roundMoney(invoice.total_amount);
    const paidAmount = roundMoney(invoice.paid_amount);
    const outstandingBalance = roundMoney(Math.max(0, totalAmount - paidAmount));
    res.json({
      success: true,
      data: {
        ...invoice,
        balance_amount: outstandingBalance,
        payment_status: outstandingBalance === 0 ? "Paid" : paidAmount > 0 ? "Partial" : "Unpaid",
        items,
        payments
      }
    });
  } catch (error) {
    console.error("Invoice detail error:", error);
    fail(res, 500, "Unable to load invoice details");
  }
});

// Create an invoice. Product stock and invoice rows are committed together.
router.post("/invoices", async (req, res) => {
  const body = req.body || {};
  const items = body.items;
  if (!Array.isArray(items) || items.length === 0) return fail(res, 400, "Add at least one product to the invoice");
  if (items.length > 100) return fail(res, 400, "An invoice cannot contain more than 100 line items");
  if (items.some((item) => !isPositiveId(item.product_id) || !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0 || (item.price !== undefined && (!Number.isFinite(Number(item.price)) || Number(item.price) < 0)))) {
    return fail(res, 400, "Each item needs a valid product, positive quantity and non-negative price");
  }
  const ids = items.map((item) => Number(item.product_id));
  if (new Set(ids).size !== ids.length) return fail(res, 400, "A product can only appear once per invoice; update its quantity instead");
  if (body.customer_id && !isPositiveId(body.customer_id)) return fail(res, 400, "Invalid customer ID");
  const discount = Number(body.discount || 0);
  const tax = Number(body.tax_amount || 0);
  if (!Number.isFinite(discount) || discount < 0 || !Number.isFinite(tax) || tax < 0) return fail(res, 400, "Discount and tax must be valid non-negative amounts");
  if (body.payment_method && !PAYMENT_METHODS.includes(body.payment_method)) return fail(res, 400, "Choose a valid payment method");
  if (!isValidDate(body.sale_date)) return fail(res, 400, "Sale date must use YYYY-MM-DD format");

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    let subtotal = 0;
    const normalized = [];
    for (const item of items) {
      const [rows] = await conn.query(`
        SELECT id, product_name, selling_price, stock_qty
        FROM products WHERE id=? FOR UPDATE`, [item.product_id]);
      if (!rows.length) throw new Error(`Product ${item.product_id} was not found`);
      const product = rows[0];
      const quantity = Number(item.quantity);
      const price = item.price === undefined ? Number(product.selling_price) : Number(item.price);
      if (Number(product.stock_qty) < quantity) throw new Error(`Insufficient stock for ${product.product_name}. Available: ${product.stock_qty}`);
      const lineTotal = roundMoney(quantity * price);
      subtotal = roundMoney(subtotal + lineTotal);
      normalized.push({ product, quantity, price, lineTotal });
    }
    if (body.customer_id) {
      const [customers] = await conn.query("SELECT id FROM customers WHERE id=?", [body.customer_id]);
      if (!customers.length) throw new Error("Selected customer was not found");
    }
    if (discount > subtotal) throw new Error("Discount cannot be greater than subtotal");
    const total = roundMoney(subtotal - discount + tax);
    const rawPaid = body.paid_amount === undefined ? total : Number(body.paid_amount);
    if (!Number.isFinite(rawPaid) || rawPaid < 0) throw new Error("Paid amount must be a valid positive number");
    const paid = roundMoney(Math.min(total, rawPaid));
    const balance = roundMoney(total - paid);
    const paymentStatus = balance === 0 ? "Paid" : paid > 0 ? "Partial" : "Unpaid";
    const invoiceNo = createInvoiceNumber();
    const [sale] = await conn.query(`
      INSERT INTO sales
        (invoice_no, customer_id, subtotal, discount, tax_amount, total_amount,
         paid_amount, balance_amount, payment_method, payment_status, sale_date, notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [invoiceNo, body.customer_id || null, subtotal, discount, tax, total, paid, balance,
       body.payment_method || "Cash", paymentStatus, body.sale_date || new Date().toISOString().slice(0, 10), body.notes || null]);

    for (const item of normalized) {
      await conn.query(`
        INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, line_total)
        VALUES (?,?,?,?,?,?)`,
        [sale.insertId, item.product.id, item.product.product_name, item.quantity, item.price, item.lineTotal]);
      await conn.query("UPDATE products SET stock_qty=stock_qty-? WHERE id=?", [item.quantity, item.product.id]);
    }
    if (paid > 0) {
      await conn.query(`
        INSERT INTO sale_payments (sale_id, amount, payment_method, reference_no, notes)
        VALUES (?,?,?,?,?)`,
        [sale.insertId, paid, body.payment_method || "Cash", body.reference_no || null, "Initial invoice payment"]);
    }
    await conn.commit();
    res.status(201).json({
      success: true,
      message: "Invoice created and stock updated successfully",
      data: { id: sale.insertId, invoice_no: invoiceNo, subtotal, discount, tax_amount: tax,
        total_amount: total, paid_amount: paid, balance_amount: balance, payment_status: paymentStatus }
    });
  } catch (error) {
    if (conn) await conn.rollback();
    console.error("Create invoice error:", error);
    fail(res, 400, error.message || "Unable to create invoice");
  } finally {
    if (conn) conn.release();
  }
});

// Record a later/partial payment against an existing invoice.
router.post("/invoices/:id/payments", async (req, res) => {
  if (!isPositiveId(req.params.id)) return fail(res, 400, "Invalid invoice ID");
  const amount = Number(req.body?.amount);
  const method = req.body?.payment_method || "Cash";
  if (!Number.isFinite(amount) || amount <= 0) return fail(res, 400, "Payment amount must be greater than zero");
  if (!PAYMENT_METHODS.includes(method)) return fail(res, 400, "Choose a valid payment method");
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [rows] = await conn.query(
      "SELECT id,total_amount,paid_amount FROM sales WHERE id=? FOR UPDATE",
      [req.params.id]
    );
    if (!rows.length) throw new Error("Invoice not found");

    const invoice = rows[0];
    const totalAmount = roundMoney(invoice.total_amount);
    const currentPaid = roundMoney(invoice.paid_amount);
    const outstandingBalance = roundMoney(Math.max(0, totalAmount - currentPaid));
    const paymentAmount = roundMoney(amount);

    // Use one calculation everywhere: outstanding = invoice total - amount already paid.
    // This also repairs stale balance_amount values when a payment is successfully saved.
    if (paymentAmount > outstandingBalance) {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        message: `Payment amount ${paymentAmount.toFixed(2)} exceeds the outstanding balance ${outstandingBalance.toFixed(2)}`,
        data: {
          requested_amount: paymentAmount,
          outstanding_balance: outstandingBalance
        }
      });
    }

    const newPaid = roundMoney(currentPaid + paymentAmount);
    const balance = roundMoney(Math.max(0, totalAmount - newPaid));
    const status = balance === 0 ? "Paid" : "Partial";
    await conn.query("UPDATE sales SET paid_amount=?, balance_amount=?, payment_status=?, payment_method=? WHERE id=?",
      [newPaid, balance, status, method, req.params.id]);
    await conn.query(`
      INSERT INTO sale_payments (sale_id, amount, payment_method, reference_no, notes)
      VALUES (?,?,?,?,?)`,
      [req.params.id, paymentAmount, method, req.body?.reference_no || null, req.body?.notes || null]);
    await conn.commit();
    res.status(201).json({ success: true, message: "Payment recorded successfully", data: { paid_amount: newPaid, balance_amount: balance, payment_status: status } });
  } catch (error) {
    if (conn) await conn.rollback();
    fail(res, 400, error.message || "Unable to record payment");
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;
