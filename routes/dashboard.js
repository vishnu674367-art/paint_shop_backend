
const router = require("express").Router();
const { pool } = require("../config/db");
const { authenticate } = require("../middleware/auth");

router.get("/", authenticate, async (_req, res) => {
  try {
    // 1. Total Sales
    const [[sales]] = await pool.query(`
      SELECT COALESCE(SUM(total_amount), 0) AS totalSales
      FROM sales
    `);

    // 2. Total Purchases
    const [[purchases]] = await pool.query(`
      SELECT COALESCE(SUM(total_amount), 0) AS totalPurchase
      FROM purchases
    `);

    // 3. Total Customers
    const [[customers]] = await pool.query(`
      SELECT COUNT(*) AS totalCustomers
      FROM customers
    `);

    // 4. Total Products
    const [[products]] = await pool.query(`
      SELECT COUNT(*) AS totalProducts
      FROM products
    `);

    // 5. Total Stock
    const [[stock]] = await pool.query(`
      SELECT COALESCE(SUM(stock_qty), 0) AS totalStock
      FROM products
    `);

    // 6. Recent Sales
    const [recentSales] = await pool.query(`
      SELECT
        s.id,
        s.invoice_no,
        c.name AS customer_name,
        s.total_amount,
        s.payment_status,
        s.sale_date
      FROM sales s
      LEFT JOIN customers c ON c.id = s.customer_id
      ORDER BY s.id DESC
      LIMIT 8
    `);

    // 7. Low Stock Products
    const [lowStock] = await pool.query(`
      SELECT
        id,
        product_name,
        sku,
        stock_qty,
        reorder_level,
        unit
      FROM products
      WHERE stock_qty <= reorder_level
      ORDER BY stock_qty ASC
      LIMIT 10
    `);

    // 8. Category-wise Sales
    const [categorySales] = await pool.query(`
      SELECT
        COALESCE(c.name, 'Uncategorized') AS category,
        SUM(si.line_total) AS amount
      FROM sale_items si
      LEFT JOIN products p ON p.id = si.product_id
      LEFT JOIN categories c ON c.id = p.category_id
      GROUP BY COALESCE(c.name, 'Uncategorized')
      ORDER BY amount DESC
    `);

    // 9. Monthly Sales - FIXED QUERY
    const [monthlySales] = await pool.query(`
      SELECT
        DATE_FORMAT(MIN(sale_date), '%b') AS month,
        MONTH(MIN(sale_date)) AS month_number,
        SUM(total_amount) AS amount
      FROM sales
      WHERE sale_date >= DATE_SUB(CURDATE(), INTERVAL 5 MONTH)
      GROUP BY YEAR(sale_date), MONTH(sale_date)
      ORDER BY YEAR(sale_date), MONTH(sale_date)
    `);

    // 10. Dashboard Response
    res.status(200).json({
      success: true,
      summary: {
        totalSales: sales.totalSales,
        totalPurchase: purchases.totalPurchase,
        totalCustomers: customers.totalCustomers,
        totalProducts: products.totalProducts,
        totalStock: stock.totalStock
      },
      recentSales,
      lowStock,
      categorySales,
      monthlySales
    });

  } catch (err) {
    console.error("Dashboard Error:", err);

    res.status(500).json({
      success: false,
      message: "Dashboard could not load",
      error: err.message
    });
  }
});

module.exports = router;
