const router = require("express").Router();
const { pool } = require("../config/db");
const { authenticate } = require("../middleware/auth");
router.use(authenticate);

const definitions = {
  products: ["product_name","sku","category_id","brand_id","shade_code","shade_name","pack_size","unit","cost_price","selling_price","stock_qty","reorder_level","description","image_url"],
  categories: ["name","description"],
  brands: ["name","description"],
  customers: ["name","phone","email","address"],
  suppliers: ["name","phone","email","address","gst_number"],
  expenses: ["title","category","amount","expense_date","payment_method","notes"]
};

for (const [table, fields] of Object.entries(definitions)) {
  router.get(`/${table}`, async (_req, res) => {
    try {
      const [rows] = await pool.query(`SELECT * FROM \`${table}\` ORDER BY id DESC LIMIT 1000`);
      res.json({ success: true, data: rows });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });
  router.get(`/${table}/:id`, async (req, res) => {
    try {
      const [rows] = await pool.query(`SELECT * FROM \`${table}\` WHERE id=?`, [req.params.id]);
      if (!rows.length) return res.status(404).json({ success: false, message: "Record not found" });
      res.json({ success: true, data: rows[0] });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });
  router.post(`/${table}`, async (req, res) => {
    try {
      const body = req.body || {};
      const keys = fields.filter(k => body[k] !== undefined);
      if (!keys.length) return res.status(400).json({ success: false, message: "No valid fields provided" });
      const required = table === "products" ? "product_name" : table === "expenses" ? "title" : "name";
      if (!body[required]) return res.status(400).json({ success: false, message: `${required} is required` });
      const [result] = await pool.query(
        `INSERT INTO \`${table}\` (${keys.map(k => `\`${k}\``).join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
        keys.map(k => body[k])
      );
      res.status(201).json({ success: true, message: "Saved successfully", id: result.insertId, data: { id: result.insertId } });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });
  router.put(`/${table}/:id`, async (req, res) => {
    try {
      const body = req.body || {};
      const keys = fields.filter(k => body[k] !== undefined);
      if (!keys.length) return res.status(400).json({ success: false, message: "No fields to update" });
      const [result] = await pool.query(
        `UPDATE \`${table}\` SET ${keys.map(k => `\`${k}\`=?`).join(",")} WHERE id=?`,
        [...keys.map(k => body[k]), req.params.id]
      );
      res.json({ success: true, message: result.affectedRows ? "Updated successfully" : "No changes or record not found" });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });
  router.delete(`/${table}/:id`, async (req, res) => {
    try {
      const [result] = await pool.query(`DELETE FROM \`${table}\` WHERE id=?`, [req.params.id]);
      res.json({ success: true, message: result.affectedRows ? "Deleted successfully" : "Record not found" });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });
}
module.exports = router;