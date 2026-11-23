const router = require("express").Router();
const { pool } = require("../config/db");
const { authenticate } = require("../middleware/auth");
router.use(authenticate);

function validItems(items) {
  return Array.isArray(items) && items.length > 0 &&
    items.every(x => (Number(x.product_id) > 0 || (x.product_name && String(x.product_name).trim().length > 0)) && Number(x.quantity) > 0);
}

// Create a sale and reduce stock in one database transaction.
// Body: { invoice_no, customer_id, discount, tax_amount, paid_amount, payment_method, sale_date, notes,
//         items:[{product_id,quantity,price}] }
router.post("/sales", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const b = req.body || {};
    if (!b.invoice_no || !validItems(b.items)) return res.status(400).json({ success: false, message: "invoice_no and valid items are required" });
    await conn.beginTransaction();
    let subtotal = 0;
    const normalized = [];
    for (const item of b.items) {
      const [rows] = await conn.query("SELECT id,product_name,selling_price,stock_qty FROM products WHERE id=? FOR UPDATE", [item.product_id]);
      if (!rows.length) throw new Error(`Product ${item.product_id} not found`);
      const product = rows[0];
      const quantity = Number(item.quantity);
      if (Number(product.stock_qty) < quantity) throw new Error(`Insufficient stock for ${product.product_name}`);
      const price = item.price === undefined ? Number(product.selling_price) : Number(item.price);
      const lineTotal = quantity * price;
      subtotal += lineTotal;
      normalized.push({ product, quantity, price, lineTotal });
    }
    const discount = Math.max(0, Number(b.discount || 0));
    const tax = Math.max(0, Number(b.tax_amount || 0));
    const total = Math.max(0, subtotal - discount + tax);
    const paid = Math.max(0, Number(b.paid_amount === undefined ? total : b.paid_amount));
    const balance = Math.max(0, total - paid);
    const paymentStatus = balance === 0 ? "Paid" : paid > 0 ? "Partial" : "Unpaid";
    const [sale] = await conn.query(
      `INSERT INTO sales (invoice_no,customer_id,subtotal,discount,tax_amount,total_amount,paid_amount,balance_amount,payment_method,payment_status,sale_date,notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [b.invoice_no,b.customer_id || null,subtotal,discount,tax,total,paid,balance,b.payment_method || "Cash",paymentStatus,b.sale_date || new Date().toISOString().slice(0,10),b.notes || null]
    );
    for (const item of normalized) {
      await conn.query(
        "INSERT INTO sale_items (sale_id,product_id,product_name,quantity,unit_price,line_total) VALUES (?,?,?,?,?,?)",
        [sale.insertId,item.product.id,item.product.product_name,item.quantity,item.price,item.lineTotal]
      );
      await conn.query("UPDATE products SET stock_qty=stock_qty-? WHERE id=?", [item.quantity,item.product.id]);
    }
    await conn.commit();
    res.status(201).json({ success: true, message: "Sale saved and stock updated", sale_id: sale.insertId, invoice_no: b.invoice_no, subtotal, total_amount: total, paid_amount: paid, balance_amount: balance, payment_status: paymentStatus });
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ success: false, message: err.message });
  } finally { conn.release(); }
});

// Create a purchase and increase stock in one database transaction.
// Body: { purchase_no,supplier_id,tax_amount,purchase_date,notes,items:[{product_id,product_name,quantity,price}] }
router.post("/purchases", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const b = req.body || {};
    let purchaseNo = b.purchase_no;
    if (!purchaseNo || typeof purchaseNo !== "string" || !purchaseNo.trim()) {
      purchaseNo = `PO-${Date.now().toString().slice(-6)}`;
    }
    if (!validItems(b.items)) {
      return res.status(400).json({ success: false, message: "purchase_no and valid items are required" });
    }
    await conn.beginTransaction();
    let subtotal = 0;
    const normalized = [];
    for (const item of b.items) {
      let product = null;
      if (item.product_id && Number(item.product_id) > 0) {
        const [rows] = await conn.query("SELECT id,product_name,cost_price FROM products WHERE id=? FOR UPDATE", [item.product_id]);
        if (rows.length) product = rows[0];
      }
      if (!product && item.product_name) {
        const pName = String(item.product_name).trim();
        const [found] = await conn.query("SELECT id,product_name,cost_price FROM products WHERE LOWER(REPLACE(product_name, ' ', '')) = LOWER(REPLACE(?, ' ', '')) LIMIT 1", [pName]);
        if (found.length) {
          product = found[0];
        } else {
          const cost = item.price !== undefined ? Number(item.price) : 0;
          const [ins] = await conn.query("INSERT INTO products (product_name, cost_price, selling_price, stock_qty) VALUES (?, ?, ?, 0)", [pName, cost, cost * 1.15]);
          product = { id: ins.insertId, product_name: pName, cost_price: cost };
        }
      }
      if (!product) throw new Error(`Product ${item.product_id || item.product_name} could not be resolved`);
      const quantity = Number(item.quantity);
      const price = item.price === undefined ? Number(product.cost_price) : Number(item.price);
      const lineTotal = quantity * price;
      subtotal += lineTotal;
      normalized.push({ product, quantity, price, lineTotal });
    }
    const tax = Math.max(0, Number(b.tax_amount || 0));
    const total = subtotal + tax;
    const [purchase] = await conn.query(
      "INSERT INTO purchases (purchase_no,supplier_id,subtotal,tax_amount,total_amount,purchase_date,notes) VALUES (?,?,?,?,?,?,?)",
      [purchaseNo, b.supplier_id || null, subtotal, tax, total, b.purchase_date || new Date().toISOString().slice(0, 10), b.notes || null]
    );
    for (const item of normalized) {
      await conn.query(
        "INSERT INTO purchase_items (purchase_id,product_id,product_name,quantity,unit_cost,line_total) VALUES (?,?,?,?,?,?)",
        [purchase.insertId, item.product.id, item.product.product_name, item.quantity, item.price, item.lineTotal]
      );
      await conn.query("UPDATE products SET stock_qty=stock_qty+? WHERE id=?", [item.quantity, item.product.id]);
    }
    await conn.commit();
    res.status(201).json({ success: true, message: "Purchase saved and stock updated", purchase_id: purchase.insertId, purchase_no: purchaseNo, total_amount: total });
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ success: false, message: err.message });
  } finally { conn.release(); }
});

router.get("/sales", async (_req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT s.*, c.name customer_name
      FROM sales s LEFT JOIN customers c ON c.id=s.customer_id
      ORDER BY s.id DESC LIMIT 1000`);
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});
router.get("/sales/:id", async (req, res) => {
  try {
    const [sales] = await pool.query("SELECT s.*,c.name customer_name,c.phone customer_phone FROM sales s LEFT JOIN customers c ON c.id=s.customer_id WHERE s.id=?", [req.params.id]);
    if (!sales.length) return res.status(404).json({ success: false, message: "Sale not found" });
    const [items] = await pool.query("SELECT * FROM sale_items WHERE sale_id=?", [req.params.id]);
    res.json({ success: true, data: { ...sales[0], items } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});
router.get("/purchases", async (_req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT p.*, s.name supplier_name
      FROM purchases p LEFT JOIN suppliers s ON s.id=p.supplier_id
      ORDER BY p.id DESC LIMIT 1000`);
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Update invoice details (notes, payment method, payment status)
router.put("/sales/:id", async (req, res) => {
  try {
    const { notes, payment_method, payment_status } = req.body || {};
    const fields = [];
    const values = [];
    if (notes !== undefined) { fields.push("notes=?"); values.push(notes); }
    if (payment_method !== undefined) { fields.push("payment_method=?"); values.push(payment_method); }
    if (payment_status !== undefined) { fields.push("payment_status=?"); values.push(payment_status); }
    if (!fields.length) return res.status(400).json({ success: false, message: "No fields provided to update" });
    values.push(req.params.id);
    await pool.query(`UPDATE sales SET ${fields.join(", ")} WHERE id=?`, values);
    res.json({ success: true, message: "Invoice updated successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Cancel invoice and restore inventory stock safely
router.post("/sales/:id/cancel", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [sales] = await conn.query("SELECT * FROM sales WHERE id=? FOR UPDATE", [req.params.id]);
    if (!sales.length) return res.status(404).json({ success: false, message: "Sale not found" });
    const sale = sales[0];
    if (sale.payment_status === "Cancelled") {
      return res.status(400).json({ success: false, message: "Invoice is already cancelled" });
    }
    const [items] = await conn.query("SELECT * FROM sale_items WHERE sale_id=?", [req.params.id]);
    for (const item of items) {
      if (item.product_id) {
        await conn.query("UPDATE products SET stock_qty = stock_qty + ? WHERE id=?", [item.quantity, item.product_id]);
      }
    }
    await conn.query("UPDATE sales SET payment_status='Cancelled', notes=CONCAT(COALESCE(notes,''), ' [Cancelled]') WHERE id=?", [req.params.id]);
    await conn.commit();
    res.json({ success: true, message: "Invoice cancelled and stock restored successfully" });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ success: false, message: err.message });
  } finally {
    conn.release();
  }
});

// Process sales return and restore inventory stock
router.post("/sales/:id/return", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { return_reason } = req.body || {};
    const [sales] = await conn.query("SELECT * FROM sales WHERE id=? FOR UPDATE", [req.params.id]);
    if (!sales.length) return res.status(404).json({ success: false, message: "Sale not found" });
    const [items] = await conn.query("SELECT * FROM sale_items WHERE sale_id=?", [req.params.id]);
    for (const item of items) {
      if (item.product_id) {
        await conn.query("UPDATE products SET stock_qty = stock_qty + ? WHERE id=?", [item.quantity, item.product_id]);
      }
    }
    await conn.query("UPDATE sales SET payment_status='Returned', notes=CONCAT(COALESCE(notes,''), ' [Returned: ', ?, ']') WHERE id=?", [return_reason || "Customer Return", req.params.id]);
    await conn.commit();
    res.json({ success: true, message: "Sales return processed and stock restored" });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ success: false, message: err.message });
  } finally {
    conn.release();
  }
});

module.exports = router;