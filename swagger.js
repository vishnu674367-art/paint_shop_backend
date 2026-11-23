const PORT = process.env.PORT || 5001;

const jsonBody = (schema) => ({
  required: true,
  content: { "application/json": { schema } }
});
const ok = (description = "Request completed successfully") => ({
  "200": { description },
  "400": { description: "Invalid request" },
  "401": { description: "Missing, invalid or expired JWT" },
  "500": { description: "Server error" }
});
const secured = [{ bearerAuth: [] }];
const idParam = [{ name: "id", in: "path", required: true, schema: { type: "integer", minimum: 1 } }];
const resourceSchema = {
  type: "object",
  additionalProperties: true,
  description: "Fields depend on the resource. Refer to the field list in the endpoint description."
};
const paths = {
  "/api/health": {
    get: { tags: ["System"], summary: "Check backend status", responses: { "200": { description: "Backend is running" } } }
  },
  "/api/auth/login": {
    post: {
      tags: ["Authentication"], summary: "Login and receive a JWT token",
      requestBody: jsonBody({ type: "object", required: ["email", "password"], properties: {
        email: { type: "string", format: "email", example: "admin@paintshop.com" },
        password: { type: "string", format: "password", example: "your-admin-password" }
      }}),
      responses: { "200": { description: "Login successful; copy token and click Authorize" }, "400": { description: "Missing or invalid email/password" }, "401": { description: "Incorrect credentials" } }
    }
  },
  "/api/auth/me": {
    get: { tags: ["Authentication"], summary: "Get the currently authenticated user", security: secured, responses: ok("Current user returned") }
  },
  "/api/dashboard": {
    get: { tags: ["Dashboard"], summary: "Get dashboard summary, recent sales, low stock and charts", security: secured, responses: ok("Dashboard data returned") }
  },
  "/api/billing/summary": {
    get: { tags: ["Billing"], summary: "Get invoice totals, collections and outstanding balances", security: secured, responses: ok() }
  },
  "/api/billing/next-invoice-number": {
    get: { tags: ["Billing"], summary: "Preview a generated invoice number", security: secured, responses: ok() }
  },
  "/api/billing/invoices": {
    get: { tags: ["Billing"], summary: "List and filter invoices", security: secured, parameters: [
      { name: "search", in: "query", schema: { type: "string" }, description: "Invoice number, customer name or phone" },
      { name: "status", in: "query", schema: { type: "string", enum: ["Paid", "Partial", "Unpaid"] } },
      { name: "from", in: "query", schema: { type: "string", format: "date" } },
      { name: "to", in: "query", schema: { type: "string", format: "date" } }
    ], responses: ok() },
    post: { tags: ["Billing"], summary: "Create an invoice and deduct product stock", security: secured,
      requestBody: jsonBody({ type: "object", required: ["items"], properties: {
        customer_id: { type: "integer", example: 1 }, discount: { type: "number", example: 0 },
        tax_amount: { type: "number", example: 0 }, paid_amount: { type: "number", example: 500 },
        payment_method: { type: "string", enum: ["Cash", "UPI", "Card", "Bank Transfer", "Other"] },
        reference_no: { type: "string" }, sale_date: { type: "string", format: "date" }, notes: { type: "string" },
        items: { type: "array", minItems: 1, items: { type: "object", required: ["product_id", "quantity"], properties: {
          product_id: { type: "integer", example: 1 }, quantity: { type: "number", example: 2 }, price: { type: "number", example: 250 }
        }}}
      }}),
      responses: { "201": { description: "Invoice created; stock deducted" }, "400": { description: "Validation or stock error" }, "401": { description: "Unauthorized" } }
    }
  },
  "/api/billing/invoices/{id}": {
    get: { tags: ["Billing"], summary: "Get invoice details, line items and payment history", security: secured, parameters: idParam, responses: ok() }
  },
  "/api/billing/invoices/{id}/payments": {
    post: { tags: ["Billing"], summary: "Record a partial or final invoice payment", security: secured, parameters: idParam,
      requestBody: jsonBody({ type: "object", required: ["amount"], properties: {
        amount: { type: "number", exclusiveMinimum: 0, example: 250 },
        payment_method: { type: "string", enum: ["Cash", "UPI", "Card", "Bank Transfer", "Other"], example: "Cash" },
        reference_no: { type: "string" }, notes: { type: "string" }
      }}), responses: { "201": { description: "Payment recorded" }, "400": { description: "Invalid payment or invoice" }, "401": { description: "Unauthorized" } }
  }
  }
};

function addResourceDocs(path, tag, fields) {
  const schema = { type: "object", properties: Object.fromEntries(fields.map(f => [f, { type: "string" }])), additionalProperties: true };
  paths[`/api/${path}`] = {
    get: { tags: [tag], summary: `List ${tag.toLowerCase()}`, security: secured, responses: ok() },
    post: { tags: [tag], summary: `Create ${tag.toLowerCase()}`, security: secured, requestBody: jsonBody(schema),
      responses: { "201": { description: "Record created" }, "400": { description: "Missing required fields" }, "401": { description: "Unauthorized" } } }
  };
  paths[`/api/${path}/{id}`] = {
    get: { tags: [tag], summary: `Get ${tag.toLowerCase()} record`, security: secured, parameters: idParam, responses: ok() },
    put: { tags: [tag], summary: `Update ${tag.toLowerCase()} record`, security: secured, parameters: idParam, requestBody: jsonBody(schema), responses: ok("Record updated") },
    delete: { tags: [tag], summary: `Delete ${tag.toLowerCase()} record`, security: secured, parameters: idParam, responses: ok("Record deleted") }
  };
}

addResourceDocs("products", "Products", ["product_name","sku","category_id","brand_id","shade_code","shade_name","pack_size","unit","cost_price","selling_price","stock_qty","reorder_level","description"]);
addResourceDocs("categories", "Products", ["name","description"]);
addResourceDocs("brands", "Products", ["name","description"]);
addResourceDocs("customers", "Customers", ["name","phone","email","address"]);
addResourceDocs("suppliers", "Suppliers", ["name","phone","email","address","gst_number"]);
addResourceDocs("expenses", "Reports", ["title","category","amount","expense_date","payment_method","notes"]);

paths["/api/sales"] = {
  get: { tags: ["Sales"], summary: "List sales", security: secured, responses: ok() },
  post: { tags: ["Sales"], summary: "Create a sale and deduct stock", security: secured,
    requestBody: jsonBody({ type: "object", required: ["invoice_no","items"], properties: {
      invoice_no: { type: "string", example: "SALE-0001" }, customer_id: { type: "integer" },
      discount: { type: "number" }, tax_amount: { type: "number" }, paid_amount: { type: "number" },
      payment_method: { type: "string" }, sale_date: { type: "string", format: "date" }, notes: { type: "string" },
      items: { type: "array", items: { type: "object", required: ["product_id","quantity"], properties: {
        product_id: { type: "integer" }, quantity: { type: "number" }, price: { type: "number" }
      }}}
    }}), responses: { "201": { description: "Sale created and stock deducted" }, "400": { description: "Validation or stock error" }, "401": { description: "Unauthorized" } }
  }
};
paths["/api/sales/{id}"] = {
  get: { tags: ["Sales"], summary: "Get sale with items and customer details", security: secured, parameters: idParam, responses: ok() }
};
paths["/api/purchases"] = {
  get: { tags: ["Purchase"], summary: "List purchases", security: secured, responses: ok() },
  post: { tags: ["Purchase"], summary: "Create a purchase and increase product stock", security: secured,
    requestBody: jsonBody({ type: "object", required: ["purchase_no","items"], properties: {
      purchase_no: { type: "string", example: "PUR-0001" }, supplier_id: { type: "integer" },
      tax_amount: { type: "number" }, purchase_date: { type: "string", format: "date" }, notes: { type: "string" },
      items: { type: "array", items: { type: "object", required: ["product_id","quantity"], properties: {
        product_id: { type: "integer" }, quantity: { type: "number" }, price: { type: "number" }
      }}}
    }}), responses: { "201": { description: "Purchase created and stock increased" }, "400": { description: "Validation error" }, "401": { description: "Unauthorized" } }
  }
};

paths["/api/reports/sales"] = { get: { tags: ["Reports"], summary: "Sales report grouped by date", security: secured, parameters: [
  { name: "from", in: "query", schema: { type: "string", format: "date" } }, { name: "to", in: "query", schema: { type: "string", format: "date" } }
], responses: ok() }};
paths["/api/reports/purchases"] = { get: { tags: ["Reports"], summary: "Purchase report grouped by date", security: secured, parameters: [
  { name: "from", in: "query", schema: { type: "string", format: "date" } }, { name: "to", in: "query", schema: { type: "string", format: "date" } }
], responses: ok() }};
paths["/api/reports/stock"] = { get: { tags: ["Reports"], summary: "Stock and low-stock report", security: secured, responses: ok() }};
paths["/api/reports/expenses"] = { get: { tags: ["Reports"], summary: "Expense report grouped by date and category", security: secured, parameters: [
  { name: "from", in: "query", schema: { type: "string", format: "date" } }, { name: "to", in: "query", schema: { type: "string", format: "date" } }
], responses: ok() }};

paths["/api/users"] = {
  get: { tags: ["Users"], summary: "List users (admin only)", security: secured, responses: ok() },
  post: { tags: ["Users"], summary: "Create a user (admin only)", security: secured,
    requestBody: jsonBody({ type: "object", required: ["name","email","password"], properties: {
      name: { type: "string" }, email: { type: "string", format: "email" }, password: { type: "string", minLength: 8 }, role: { type: "string", enum: ["admin","staff"], default: "staff" }
    }}), responses: { "201": { description: "User created" }, "400": { description: "Validation error" }, "401": { description: "Unauthorized" }, "403": { description: "Admin only" }, "409": { description: "Email already exists" } } }
};
paths["/api/users/{id}"] = {
  get: { tags: ["Users"], summary: "Get user (admin only)", security: secured, parameters: idParam, responses: ok() },
  put: { tags: ["Users"], summary: "Update user (admin only)", security: secured, parameters: idParam,
    requestBody: jsonBody({ type: "object", properties: { name: { type: "string" }, email: { type: "string", format: "email" }, password: { type: "string", minLength: 8 }, role: { type: "string", enum: ["admin","staff"] } }}), responses: ok() },
  delete: { tags: ["Users"], summary: "Delete user (admin only)", security: secured, parameters: idParam, responses: ok() }
};
paths["/api/settings"] = {
  get: { tags: ["Settings"], summary: "Get application settings (admin only)", security: secured, responses: ok() },
  put: { tags: ["Settings"], summary: "Create or update application settings (admin only)", security: secured,
    requestBody: jsonBody({ type: "object", required: ["settings"], properties: { settings: { type: "object", additionalProperties: { oneOf: [{type:"string"},{type:"number"},{type:"boolean"},{type:"object"},{type:"array"},{type:"null"}] }, example: { shop_name: "My Paint Shop", phone: "9876543210", currency: "INR" } } }}), responses: ok("Settings saved") }
};

module.exports = {
  openapi: "3.0.3",
  info: {
    title: "Paint Shop Management API",
    version: "2.0.0",
    description: "Swagger documentation for the Paint Shop Management backend. Login using POST /api/auth/login, copy the returned token, then use Authorize to access protected endpoints."
  },
  servers: [{ url: `http://localhost:${PORT}`, description: "Local development server" }],
  tags: [
    { name: "System" }, { name: "Authentication" }, { name: "Dashboard" }, { name: "Billing" },
    { name: "Sales" }, { name: "Purchase" }, { name: "Products" }, { name: "Customers" },
    { name: "Suppliers" }, { name: "Reports" }, { name: "Users" }, { name: "Settings" }
  ],
  components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } } },
  paths
};
