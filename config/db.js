
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");

// ==========================================
// 1. DATABASE ENVIRONMENT CONFIGURATION
// ==========================================

const configuredDatabase = process.env.DB_NAME;

const databaseName = configuredDatabase || "paint_shop_db";

if (!/^[a-zA-Z0-9_]+$/.test(databaseName)) {
  throw new Error("Invalid DB_NAME. Use only letters, numbers and underscores.");
}

// ==========================================
// 2. MYSQL SSL CONFIGURATION (AIVEN)
// ==========================================

function getSSLConfig() {
  const sslEnabled = /^true$/i.test(
    process.env.DB_SSL || ""
  );

  if (!sslEnabled) {
    return undefined;
  }

  const caValue = (process.env.DB_SSL_CA || "").trim();

  if (!caValue) {
    return {
      rejectUnauthorized: false
    };
  }

  let caCertificate = null;

  // Certificate content from Render environment
  if (caValue.includes("-----BEGIN CERTIFICATE-----")) {
    caCertificate = caValue
      .replace(/\\r\\n/g, "\n")
      .replace(/\\n/g, "\n")
      .replace(/\r\n/g, "\n")
      .trim();
  }
  // Certificate file path
  else {
    const caPath = path.isAbsolute(caValue)
      ? caValue
      : path.resolve(process.cwd(), caValue);

    if (fs.existsSync(caPath)) {
      caCertificate = fs.readFileSync(caPath, "utf8").trim();
    }
  }

  if (
    caCertificate &&
    caCertificate.startsWith("-----BEGIN CERTIFICATE-----") &&
    caCertificate.includes("-----END CERTIFICATE-----")
  ) {
    return {
      ca: caCertificate,
      rejectUnauthorized: false
    };
  }

  return {
    rejectUnauthorized: false
  };
}

// ==========================================
// 3. MYSQL CONNECTION CONFIGURATION
// ==========================================

const sslOptions = getSSLConfig();

const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  connectTimeout: 20000,
  ...(sslOptions ? { ssl: sslOptions } : {})
};

if (
  !Number.isInteger(dbConfig.port) ||
  dbConfig.port < 1 ||
  dbConfig.port > 65535
) {
  throw new Error("Invalid DB_PORT configuration.");
}

// ==========================================
// 4. MYSQL CONNECTION POOL
// ==========================================

const pool = mysql.createPool({
  ...dbConfig,
  database: databaseName,

  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,

  decimalNumbers: true,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});

// ==========================================
// 5. DATABASE TABLE SCHEMAS
// ==========================================

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
  ) ENGINE=InnoDB`,

  // CATEGORIES
  `CREATE TABLE IF NOT EXISTS categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`,

  // BRANDS
  `CREATE TABLE IF NOT EXISTS brands (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`,

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
    FOREIGN KEY (category_id)
      REFERENCES categories(id) ON DELETE SET NULL,
    FOREIGN KEY (brand_id)
      REFERENCES brands(id) ON DELETE SET NULL
  ) ENGINE=InnoDB`,

  // CUSTOMERS
  `CREATE TABLE IF NOT EXISTS customers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    phone VARCHAR(30),
    email VARCHAR(190),
    address TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`,

  // SUPPLIERS
  `CREATE TABLE IF NOT EXISTS suppliers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    phone VARCHAR(30),
    email VARCHAR(190),
    address TEXT,
    gst_number VARCHAR(40),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`,

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
    payment_status ENUM('Paid','Partial','Unpaid')
      NOT NULL DEFAULT 'Paid',
    sale_date DATE NOT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id)
      REFERENCES customers(id) ON DELETE SET NULL
  ) ENGINE=InnoDB`,

  // SALE ITEMS
  `CREATE TABLE IF NOT EXISTS sale_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    sale_id INT NOT NULL,
    product_id INT NULL,
    product_name VARCHAR(180) NOT NULL,
    quantity DECIMAL(12,3) NOT NULL,
    unit_price DECIMAL(12,2) NOT NULL,
    line_total DECIMAL(12,2) NOT NULL,
    FOREIGN KEY (sale_id)
      REFERENCES sales(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id)
      REFERENCES products(id) ON DELETE SET NULL
  ) ENGINE=InnoDB`,

  // SALE PAYMENTS
  `CREATE TABLE IF NOT EXISTS sale_payments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    sale_id INT NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    payment_method ENUM(
      'Cash','UPI','Card','Bank Transfer','Other'
    ) NOT NULL DEFAULT 'Cash',
    reference_no VARCHAR(120),
    payment_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_sale_payments_sale_id (sale_id),
    FOREIGN KEY (sale_id)
      REFERENCES sales(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`,

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
    FOREIGN KEY (supplier_id)
      REFERENCES suppliers(id) ON DELETE SET NULL
  ) ENGINE=InnoDB`,

  // PURCHASE ITEMS
  `CREATE TABLE IF NOT EXISTS purchase_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    purchase_id INT NOT NULL,
    product_id INT NULL,
    product_name VARCHAR(180) NOT NULL,
    quantity DECIMAL(12,3) NOT NULL,
    unit_cost DECIMAL(12,2) NOT NULL,
    line_total DECIMAL(12,2) NOT NULL,
    FOREIGN KEY (purchase_id)
      REFERENCES purchases(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id)
      REFERENCES products(id) ON DELETE SET NULL
  ) ENGINE=InnoDB`,

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
  ) ENGINE=InnoDB`,

  // APP SETTINGS
  `CREATE TABLE IF NOT EXISTS app_settings (
    setting_key VARCHAR(100) PRIMARY KEY,
    setting_value TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`
];

// ==========================================
// 6. INITIALIZE DATABASE
// ==========================================

async function initializeDatabase() {
  let bootstrap = null;
  let connection = null;

  try {
    console.log("Connecting to Paint Shop database...");

    // Create database only when DB_NAME is not provided
    if (!configuredDatabase) {
      bootstrap = await mysql.createConnection(dbConfig);

      await bootstrap.query(
        `CREATE DATABASE IF NOT EXISTS \`${databaseName}\``
      );

      await bootstrap.end();
      bootstrap = null;
    }

    // Test connection
    connection = await pool.getConnection();

    await connection.ping();

    console.log("MySQL connection successful.");

    // Create tables
    for (const sql of schemas) {
      await connection.query(sql);
    }

    // Existing database migration: image_url
    const [imageColumns] = await connection.query(
      "SHOW COLUMNS FROM products LIKE 'image_url'"
    );

    if (imageColumns.length === 0) {
      await connection.query(
        "ALTER TABLE products ADD COLUMN image_url TEXT NULL"
      );
    }

    console.log("All database tables checked successfully.");

    // ======================================
    // 7. DEFAULT ADMIN CREATION
    // ======================================

    const adminEmail =
      process.env.ADMIN_EMAIL || "admin@paintshop.com";

    const adminPassword = process.env.ADMIN_PASSWORD || "admin123";

    const adminName =
      process.env.ADMIN_NAME || "Shop Admin";

    const [admins] = await connection.query(
      "SELECT id FROM users WHERE email = ? LIMIT 1",
      [adminEmail]
    );

    if (admins.length === 0) {
      const hashedPassword = await bcrypt.hash(
        adminPassword,
        12
      );

      await connection.query(
        `INSERT IGNORE INTO users
        (name, email, password_hash, role)
        VALUES (?, ?, ?, 'admin')`,
        [adminName, adminEmail, hashedPassword]
      );

      console.log("Default admin account checked.");
    } else {
      console.log("Admin account already exists.");
    }

    console.log("----------------------------------");
    console.log("PAINT SHOP DATABASE READY");
    console.log("MySQL SSL:", sslOptions ? "ENABLED" : "DISABLED");
    console.log("Database:", databaseName);
    console.log("----------------------------------");

  } catch (error) {
    console.error("DATABASE INITIALIZATION ERROR:", error);
    throw error;

  } finally {
    if (connection) {
      connection.release();
    }

    if (bootstrap) {
      await bootstrap.end().catch(() => {});
    }
  }
}

// ==========================================
// 8. CLOSE DATABASE POOL
// ==========================================

async function closeDatabase() {
  await pool.end();
  console.log("MySQL connection pool closed.");
}

// ==========================================
// 9. EXPORT
// ==========================================

module.exports = {
  pool,
  initializeDatabase,
  closeDatabase
};
