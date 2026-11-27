
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");

// ==========================================
// DATABASE SSL CONFIGURATION
// ==========================================

function getSSLConfig() {
  const sslEnabled = /^true$/i.test(process.env.DB_SSL || "");

  if (!sslEnabled) {
    return undefined;
  }

  const sslOptions = {
    rejectUnauthorized: true
  };

  const caValue = process.env.DB_SSL_CA;

  if (!caValue) {
    throw new Error(
      "DB_SSL is enabled, but DB_SSL_CA is missing. " +
      "Add your Aiven CA certificate content to Render Environment."
    );
  }

  // Option 1: Certificate content directly from environment variable
  if (caValue.includes("-----BEGIN CERTIFICATE-----")) {
    sslOptions.ca = caValue.replace(/\\n/g, "\n");
  } 
  // Option 2: Certificate file path
  else {
    const caPath = path.isAbsolute(caValue)
      ? caValue
      : path.resolve(process.cwd(), caValue);

    if (!fs.existsSync(caPath)) {
      throw new Error(
        `SSL certificate not found: ${caPath}. ` +
        "Provide the certificate content in DB_SSL_CA or upload the certificate file."
      );
    }

    sslOptions.ca = fs.readFileSync(caPath, "utf8");
  }

  return sslOptions;
}

// ==========================================
// DATABASE CONFIGURATION
// ==========================================

const sslOptions = getSSLConfig();

const configuredDatabase = process.env.DB_NAME;

const databaseName = (
  configuredDatabase || "paint_shop_db"
).replace(/[^a-zA-Z0-9_]/g, "");

if (!databaseName) {
  throw new Error("Invalid DB_NAME configuration.");
}

const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  ...(sslOptions ? { ssl: sslOptions } : {})
};

const pool = mysql.createPool({
  ...dbConfig,
  database: databaseName,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  decimalNumbers: true
});

// ==========================================
// INITIALIZE DATABASE
// ==========================================

async function initializeDatabase() {
  // Create database if DB_NAME is not configured
  if (!configuredDatabase) {
    const bootstrap = await mysql.createConnection(dbConfig);

    try {
      await bootstrap.query(
        `CREATE DATABASE IF NOT EXISTS \`${databaseName}\``
      );
    } finally {
      await bootstrap.end();
    }
  }

  const connection = await pool.getConnection();

  try {
    const schemas = [

      // USERS
      `CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        email VARCHAR(190) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'staff',
        permissions TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,

      // CATEGORIES
      `CREATE TABLE IF NOT EXISTS categories (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(120) NOT NULL UNIQUE,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,

      // BRANDS
      `CREATE TABLE IF NOT EXISTS brands (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(120) NOT NULL UNIQUE,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,

      // PRODUCTS
      `CREATE TABLE IF NOT EXISTS products (
        id INT AUTO_INCREMENT PRIMARY KEY,
        product_name VARCHAR(180) NOT NULL,
        sku VARCHAR(80) UNIQUE,
        category_id INT NULL,
        brand_id INT NULL,
        shade_code VARCHAR(80),
        shade_name VARCHAR(120),
        pack_size VARCHAR(80),
        unit VARCHAR(30) NOT NULL DEFAULT 'piece',
        cost_price DECIMAL(12,2) NOT NULL DEFAULT 0,
        selling_price DECIMAL(12,2) NOT NULL DEFAULT 0,
        stock_qty DECIMAL(12,3) NOT NULL DEFAULT 0,
        reorder_level DECIMAL(12,3) NOT NULL DEFAULT 0,
        description TEXT,
        image_url TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
        FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE SET NULL
      )`,

      // CUSTOMERS
      `CREATE TABLE IF NOT EXISTS customers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        phone VARCHAR(30),
        email VARCHAR(190),
        address TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,

      // SUPPLIERS
      `CREATE TABLE IF NOT EXISTS suppliers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        phone VARCHAR(30),
        email VARCHAR(190),
        address TEXT,
        gst_number VARCHAR(40),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,

      // SALES
      `CREATE TABLE IF NOT EXISTS sales (
        id INT AUTO_INCREMENT PRIMARY KEY,
        invoice_no VARCHAR(60) NOT NULL UNIQUE,
        customer_id INT NULL,
        subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
        discount DECIMAL(12,2) NOT NULL DEFAULT 0,
        tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        paid_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        balance_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        payment_method VARCHAR(50),
        payment_status ENUM('Paid','Partial','Unpaid') NOT NULL DEFAULT 'Paid',
        sale_date DATE NOT NULL,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
      )`,

      // SALE ITEMS
      `CREATE TABLE IF NOT EXISTS sale_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        sale_id INT NOT NULL,
        product_id INT NULL,
        product_name VARCHAR(180) NOT NULL,
        quantity DECIMAL(12,3) NOT NULL,
        unit_price DECIMAL(12,2) NOT NULL,
        line_total DECIMAL(12,2) NOT NULL,
        FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
      )`,

      // SALE PAYMENTS
      `CREATE TABLE IF NOT EXISTS sale_payments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        sale_id INT NOT NULL,
        amount DECIMAL(12,2) NOT NULL,
        payment_method ENUM('Cash','UPI','Card','Bank Transfer','Other') NOT NULL DEFAULT 'Cash',
        reference_no VARCHAR(120),
        payment_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_sale_payments_sale_id (sale_id),
        FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
      )`,

      // PURCHASES
      `CREATE TABLE IF NOT EXISTS purchases (
        id INT AUTO_INCREMENT PRIMARY KEY,
        purchase_no VARCHAR(60) NOT NULL UNIQUE,
        supplier_id INT NULL,
        subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
        tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        purchase_date DATE NOT NULL,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL
      )`,

      // PURCHASE ITEMS
      `CREATE TABLE IF NOT EXISTS purchase_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        purchase_id INT NOT NULL,
        product_id INT NULL,
        product_name VARCHAR(180) NOT NULL,
        quantity DECIMAL(12,3) NOT NULL,
        unit_cost DECIMAL(12,2) NOT NULL,
        line_total DECIMAL(12,2) NOT NULL,
        FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
      )`,

      // EXPENSES
      `CREATE TABLE IF NOT EXISTS expenses (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(180) NOT NULL,
        category VARCHAR(100),
        amount DECIMAL(12,2) NOT NULL,
        expense_date DATE NOT NULL,
        payment_method VARCHAR(50),
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,

      // APP SETTINGS
      `CREATE TABLE IF NOT EXISTS app_settings (
        setting_key VARCHAR(100) PRIMARY KEY,
        setting_value TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )`
    ];

    // Create all tables
    for (const sql of schemas) {
      await connection.query(sql);
    }

    // Check products image_url column
    const [imageUrlColumns] = await connection.query(
      "SHOW COLUMNS FROM products LIKE 'image_url'"
    );

    if (!imageUrlColumns.length) {
      await connection.query(
        "ALTER TABLE products ADD COLUMN image_url TEXT NULL"
      );
    }

    // ======================================
    // DEFAULT ADMIN CREATION
    // ======================================

    const email = process.env.ADMIN_EMAIL || "admin@paintshop.com";

    const [admins] = await connection.query(
      "SELECT id FROM users WHERE email = ?",
      [email]
    );

    if (!admins.length) {
      const adminPassword =
        process.env.ADMIN_PASSWORD || "Admin@123";

      const hash = await bcrypt.hash(adminPassword, 10);

      await connection.query(
        `INSERT INTO users
        (name, email, password_hash, role)
        VALUES (?, ?, ?, 'admin')`,
        [
          process.env.ADMIN_NAME || "Shop Admin",
          email,
          hash
        ]
      );

      console.log(`Default admin created: ${email}`);
    }

    console.log("Database initialized successfully.");
    
  } catch (error) {
    console.error("Database initialization failed:", error);
    throw error;
  } finally {
    connection.release();
  }
}

// ==========================================
// EXPORT
// ==========================================

module.exports = {
  pool,
  initializeDatabase
};
