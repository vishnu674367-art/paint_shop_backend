require("dotenv").config();

const express = require("express");
const cors = require("cors");
const swaggerUi = require("swagger-ui-express");
const { initializeDatabase } = require("./config/db");
const swaggerDocument = require("./swagger");

const authRoutes = require("./routes/auth");
const dashboardRoutes = require("./routes/dashboard");
const resourceRoutes = require("./routes/resources");
const transactionRoutes = require("./routes/transactions");
const billingRoutes = require("./routes/billing");
const reportsRoutes = require("./routes/reports");
const usersRoutes = require("./routes/users");
const settingsRoutes = require("./routes/settings");

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors({
  origin: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

app.get("/api/health", (_req, res) => {
  res.status(200).json({ success: true, message: "Paint Shop Management API is running" });
});

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument, {
  explorer: true,
  customSiteTitle: "Paint Shop Management API - Swagger"
}));
app.get("/api-docs.json", (_req, res) => res.json(swaggerDocument));

app.use("/api/auth", authRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/billing", billingRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api", resourceRoutes);
app.use("/api", transactionRoutes);

app.use((req, res) => res.status(404).json({ success: false, message: "API endpoint not found" }));

async function startServer() {
  try {
    await initializeDatabase();
    app.listen(PORT, () => {
      console.log("-----------------------------------");
      console.log("PAINT SHOP BACKEND STARTED");
      console.log("-----------------------------------");
      console.log(`Server:  http://localhost:${PORT}`);
      console.log(`Swagger: http://localhost:${PORT}/api-docs`);
      console.log(`OpenAPI: http://localhost:${PORT}/api-docs.json`);
      console.log(`Health:  http://localhost:${PORT}/api/health`);
      console.log("-----------------------------------");
    });
  } catch (error) {
    console.error("Startup/Database Error:", error.message);
    process.exit(1);
  }
}
startServer();
