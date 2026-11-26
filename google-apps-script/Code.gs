const CONFIG = {
  HEADER_ROW: 4,
  FIRST_DATA_ROW: 5,
  MAX_ROWS: 2000,
  SHEETS: ["Dashboard", "Products", "Sales", "Stock In", "Expenses", "Miscellaneous"]
};

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    if (!body.apiKey || body.apiKey !== PropertiesService.getScriptProperties().getProperty("API_KEY")) {
      return json_({ ok: false, error: "Unauthorized" });
    }
    const result = route_(body);
    return json_({ ok: true, data: result });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function doGet() {
  return json_({ ok: true, message: "Lifeofthreads Sheets API is running. Send POST requests through the Netlify app." });
}

function route_(b) {
  const action = b.action;
  if (action === "bootstrap") return bootstrap_();
  if (action === "addProduct") return addProduct_(b.record || {});
  if (action === "addSale") return addSale_(b.record || {});
  if (action === "addStock") return addStock_(b.record || {});
  if (action === "addExpense") return addExpense_(b.record || {});
  if (action === "addMisc") return addMisc_(b.record || {});
  if (action === "updateSale") return updateSale_(b.record || {});
  throw new Error("Unknown action");
}

function ss_() {
  const id = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (!id) throw new Error("Set SPREADSHEET_ID in Apps Script project properties.");
  return SpreadsheetApp.openById(id);
}
function sheet_(name) {
  const s = ss_().getSheetByName(name);
  if (!s) throw new Error("Missing sheet: " + name);
  return s;
}
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function nextRow_(s, col) {
  const start = CONFIG.FIRST_DATA_ROW;
  const vals = s.getRange(start, col, CONFIG.MAX_ROWS, 1).getDisplayValues();
  for (let i = 0; i < vals.length; i++) if (!vals[i][0]) return start + i;
  throw new Error("No empty rows left in " + s.getName() + ". Increase MAX_ROWS in Code.gs.");
}
function required_(v, label) {
  if (v === undefined || v === null || String(v).trim() === "") throw new Error(label + " is required.");
  return v;
}
function number_(v, label, allowZero) {
  const n = Number(v);
  if (!isFinite(n) || (allowZero ? n < 0 : n <= 0)) throw new Error(label + " must be a valid " + (allowZero ? "non-negative" : "positive") + " number.");
  return n;
}
function dateValue_(v) {
  if (!v) return new Date();
  const d = new Date(v + (String(v).length === 10 ? "T12:00:00" : ""));
  if (isNaN(d.getTime())) throw new Error("Invalid date.");
  return d;
}
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { return fn(); } finally { lock.releaseLock(); }
}
function bootstrap_() {
  const ss = ss_();
  const products = readTable_(sheet_("Products"), 19);
  const sales = readTable_(sheet_("Sales"), 16);
  const stock = readTable_(sheet_("Stock In"), 7);
  const expenses = readTable_(sheet_("Expenses"), 6);
  const misc = readTable_(sheet_("Miscellaneous"), 6);
  const dash = sheet_("Dashboard");
  const dashboard = {
    productCount: dash.getRange("A5").getValue(),
    unitsSold: dash.getRange("C5").getValue(),
    availableUnits: dash.getRange("E5").getValue(),
    lowStock: dash.getRange("G5").getValue(),
    netSales: dash.getRange("A9").getValue(),
    productCost: dash.getRange("C9").getValue(),
    grossProfit: dash.getRange("E9").getValue(),
    businessExpenses: dash.getRange("G9").getValue(),
    stockInvestment: dash.getRange("A25").getValue(),
    stockValue: dash.getRange("C25").getValue(),
    miscCosts: dash.getRange("E25").getValue(),
    totalExpenses: dash.getRange("G25").getValue()
  };
  return { dashboard, products, sales, stock, expenses, misc };
}
function readTable_(s, cols) {
  const last = Math.max(s.getLastRow(), CONFIG.HEADER_ROW);
  if (last < CONFIG.FIRST_DATA_ROW) return [];
  const values = s.getRange(CONFIG.HEADER_ROW, 1, last - CONFIG.HEADER_ROW + 1, cols).getDisplayValues();
  const headers = values.shift();
  return values.filter(r => r.some(x => x !== "")).map(r => {
    const o = {};
    headers.forEach((h, i) => o[h] = r[i]);
    return o;
  });
}
function addProduct_(r) {
  return withLock_(() => {
    const s = sheet_("Products");
    const sku = String(required_(r.sku, "SKU")).trim();
    const existing = s.getRange(CONFIG.FIRST_DATA_ROW, 1, CONFIG.MAX_ROWS, 1).getDisplayValues().flat();
    if (existing.includes(sku)) throw new Error("That SKU already exists.");
    const row = nextRow_(s, 1);
    s.getRange(row, 1, 1, 9).setValues([[
      sku, required_(r.name, "Product name"), r.category || "", r.colour || "", r.size || "",
      r.supplier || "", number_(r.unitCost, "Unit cost", true), number_(r.sellingPrice, "Selling price", true),
      number_(r.openingStock || 0, "Opening stock", true)
    ]]);
    s.getRange(row, 16).setValue(number_(r.reorderLevel || 0, "Reorder level", true));
    copyProductFormulas_(s, row);
    SpreadsheetApp.flush();
    return { message: "Product added", sku };
  });
}
function copyProductFormulas_(s, row) {
  const template = row > CONFIG.FIRST_DATA_ROW ? row - 1 : CONFIG.FIRST_DATA_ROW;
  [10,11,12,13,14,15,17,18,19].forEach(c => {
    const f = s.getRange(template, c).getFormulaR1C1();
    if (f) s.getRange(row, c).setFormulaR1C1(f);
  });
}
function addSale_(r) {
  return withLock_(() => {
    const s = sheet_("Sales");
    const row = nextRow_(s, 1);
    const qty = number_(r.quantity, "Quantity", false);
    const sku = String(required_(r.sku, "SKU")).trim();
    if (!productExists_(sku)) throw new Error("SKU not found in Products.");
    s.getRange(row, 1, 1, 5).setValues([[
      required_(r.orderId, "Order ID"), dateValue_(r.orderDate), r.channel || "Instagram",
      r.customer || "", sku
    ]]);
    s.getRange(row, 7, 1, 4).setValues([[
      qty, number_(r.sellingPrice, "Selling price", true), number_(r.discount || 0, "Discount", true),
      r.status || "Confirmed"
    ]]);
    s.getRange(row, 15, 1, 2).setValues([[r.paymentStatus || "Pending", r.notes || ""]]);
    copySaleFormulas_(s, row);
    SpreadsheetApp.flush();
    return { message: "Sale recorded", orderId: r.orderId };
  });
}
function copySaleFormulas_(s, row) {
  const template = row > CONFIG.FIRST_DATA_ROW ? row - 1 : CONFIG.FIRST_DATA_ROW;
  [6,11,12,13,14].forEach(c => {
    const f = s.getRange(template, c).getFormulaR1C1();
    if (f) s.getRange(row, c).setFormulaR1C1(f);
  });
}
function productExists_(sku) {
  return sheet_("Products").getRange(CONFIG.FIRST_DATA_ROW, 1, CONFIG.MAX_ROWS, 1).getDisplayValues().flat().includes(sku);
}
function addStock_(r) {
  return withLock_(() => {
    const sku = String(required_(r.sku, "SKU")).trim();
    if (!productExists_(sku)) throw new Error("SKU not found in Products.");
    const s = sheet_("Stock In"), row = nextRow_(s, 1);
    s.getRange(row, 1, 1, 7).setValues([[
      dateValue_(r.date), r.reference || ("STK-" + new Date().getTime()), sku,
      number_(r.quantity, "Quantity", false), number_(r.unitCost, "Unit cost", true),
      r.supplier || "", r.notes || ""
    ]]);
    SpreadsheetApp.flush();
    return { message: "Stock purchase recorded" };
  });
}
function addExpense_(r) {
  const s = sheet_("Expenses"), row = nextRow_(s, 1);
  s.getRange(row, 1, 1, 6).setValues([[
    dateValue_(r.date), required_(r.type, "Expense type"), required_(r.description, "Description"),
    r.relatedOrder || "", number_(r.amount, "Amount", false), r.notes || ""
  ]]);
  return { message: "Expense recorded" };
}
function addMisc_(r) {
  const s = sheet_("Miscellaneous"), row = nextRow_(s, 1);
  const qty = r.quantity === "" || r.quantity === null || r.quantity === undefined ? "" : number_(r.quantity, "Quantity", false);
  const unit = r.unitCost === "" || r.unitCost === null || r.unitCost === undefined ? "" : number_(r.unitCost, "Unit cost", true);
  if (qty === "" && unit === "") throw new Error("Enter a unit cost, or both quantity and unit cost.");
  s.getRange(row, 1, 1, 5).setValues([[
    dateValue_(r.date), required_(r.category, "Category"), required_(r.description, "Description"), qty, unit
  ]]);
  const template = row > CONFIG.FIRST_DATA_ROW ? row - 1 : CONFIG.FIRST_DATA_ROW;
  const f = s.getRange(template, 6).getFormulaR1C1();
  if (f) s.getRange(row, 6).setFormulaR1C1(f);
  else s.getRange(row, 6).setFormula('=IF(COUNTA(B' + row + ':E' + row + ')=0,"",IF(OR(D' + row + '="",E' + row + '=""),IF(E' + row + '="",0,E' + row + '),D' + row + '*E' + row + '))');
  SpreadsheetApp.flush();
  return { message: "Miscellaneous cost recorded" };
}
function updateSale_(r) {
  const s = sheet_("Sales");
  const orderId = String(required_(r.orderId, "Order ID")).trim();
  const last = Math.max(s.getLastRow(), CONFIG.HEADER_ROW);
  const ids = s.getRange(CONFIG.FIRST_DATA_ROW, 1, Math.max(1, last - CONFIG.HEADER_ROW), 1).getDisplayValues().flat();
  const index = ids.findIndex(x => x === orderId);
  if (index < 0) throw new Error("Order ID not found.");
  const matchingRows = [];
  ids.forEach((value, i) => { if (value === orderId) matchingRows.push(CONFIG.FIRST_DATA_ROW + i); });
  matchingRows.forEach(row => {
    if (r.status) s.getRange(row, 10).setValue(r.status);
    if (r.paymentStatus) s.getRange(row, 15).setValue(r.paymentStatus);
    if (r.notes !== undefined) s.getRange(row, 16).setValue(r.notes);
  });
  SpreadsheetApp.flush();
  return { message: "Sale updated", rowsUpdated: matchingRows.length };
}
