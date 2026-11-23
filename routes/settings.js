const router = require("express").Router();
const { pool } = require("../config/db");
const { authenticate, adminOnly } = require("../middleware/auth");

router.use(authenticate, adminOnly);

router.get("/", async (_req, res) => {
  try {
    const [rows] = await pool.query("SELECT setting_key, setting_value, updated_at FROM app_settings ORDER BY setting_key");
    const settings = Object.fromEntries(rows.map(row => [row.setting_key, row.setting_value]));
    res.json({ success: true, data: settings });
  } catch (err) {
    res.status(500).json({ success: false, message: "Unable to load settings" });
  }
});

router.put("/", async (req, res) => {
  const settings = req.body?.settings;
  if (!settings || typeof settings !== "object" || Array.isArray(settings) || !Object.keys(settings).length) {
    return res.status(400).json({ success: false, message: "settings must be a non-empty object" });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const [key, value] of Object.entries(settings)) {
      if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(key)) throw new Error(`Invalid setting key: ${key}`);
      const serialized = typeof value === "string" ? value : JSON.stringify(value);
      await connection.query(
        `INSERT INTO app_settings (setting_key, setting_value) VALUES (?,?)
         ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)`,
        [key, serialized]
      );
    }
    await connection.commit();
    res.json({ success: true, message: "Settings saved successfully" });
  } catch (err) {
    await connection.rollback();
    res.status(400).json({ success: false, message: err.message || "Unable to save settings" });
  } finally {
    connection.release();
  }
});

module.exports = router;
