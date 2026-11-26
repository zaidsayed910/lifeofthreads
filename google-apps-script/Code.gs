
const CONFIG = {
  HEADER_ROW: 4,
  FIRST_DATA_ROW: 5,
  MAX_ROWS: 2000,
  SHEETS: [
    "Dashboard",
    "Products",
    "Sales",
    "Stock In",
    "Stock Adjustments",
    "Expenses",
    "Miscellaneous"
  ]
};

/* ========== API ========== */

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");

    if (
      !body.apiKey ||
      body.apiKey !== PropertiesService.getScriptProperties().getProperty("API_KEY")
    ) {
      return json_({ ok: false, error: "Unauthorized" });
    }

    const result = route_(body);
    return json_({ ok: true, data: result });

  } catch (err) {
    return json_({
      ok: false,
      error: String(err && err.message ? err.message : err)
    });
  }
}

function doGet() {
  return json_({
    ok: true,
    message: "Lifeofthreads Sheets API is running. Send POST requests through the Netlify app."
  });
}

function route_(b) {
  const action = b.action;
  const r = b.record || {};

  if (action === "bootstrap") return bootstrap_();

  if (action === "addProduct") return addProduct_(r);
  if (action === "updateProduct") return updateProduct_(r);
  if (action === "deleteProduct") return deleteProduct_(r);

  if (action === "addSale") return addSale_(r);
  if (action === "updateSale") return updateSale_(r);
  if (action === "deleteSale") return deleteSale_(r);

  if (action === "addStock") return addStock_(r);
  if (action === "updateStock") return updateStock_(r);
  if (action === "deleteStock") return deleteStock_(r);

  if (action === "addStockAdjustment") return addStockAdjustment_(r);
  if (action === "updateStockAdjustment") return updateStockAdjustment_(r);
  if (action === "deleteStockAdjustment") return deleteStockAdjustment_(r);

  if (action === "addExpense") return addExpense_(r);
  if (action === "updateExpense") return updateExpense_(r);
  if (action === "deleteExpense") return deleteExpense_(r);

  if (action === "addMisc") return addMisc_(r);
  if (action === "updateMisc") return updateMisc_(r);
  if (action === "deleteMisc") return deleteMisc_(r);

  throw new Error("Unknown action: " + action);
}

/* ========== COMMON HELPERS ========== */

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
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function nextRow_(s, col) {
  const start = CONFIG.FIRST_DATA_ROW;
  const vals = s.getRange(start, col, CONFIG.MAX_ROWS, 1).getDisplayValues();

  for (let i = 0; i < vals.length; i++) {
    if (!vals[i][0]) return start + i;
  }

  throw new Error("No empty rows left in " + s.getName() + ". Increase MAX_ROWS in Code.gs.");
}

function required_(v, label) {
  if (v === undefined || v === null || String(v).trim() === "") {
    throw new Error(label + " is required.");
  }
  return v;
}

function number_(v, label, allowZero) {
  const n = Number(v);

  if (!isFinite(n) || (allowZero ? n < 0 : n <= 0)) {
    throw new Error(
      label + " must be a valid " +
      (allowZero ? "non-negative" : "positive") + " number."
    );
  }

  return n;
}

// Stock adjustments must accept both positive and negative quantities.
function adjustmentQuantity_(v) {
  if (v === undefined || v === null || String(v).trim() === "") {
    throw new Error("Quantity change is required.");
  }

  const n = Number(v);

  if (!isFinite(n) || !Number.isInteger(n) || n === 0) {
    throw new Error("Quantity change must be a non-zero whole number.");
  }

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

  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/* ========== INVENTORY FORMULAS ========== */

// Updates the stock formulas for all existing products.
// L = Opening Stock + Stock Added + Adjustments - Units Sold
// Q = Automatic stock status.
function applyInventoryFormulas_() {
  const s = sheet_("Products");
  const last = Math.max(s.getLastRow(), CONFIG.FIRST_DATA_ROW);
  const end = Math.min(last, CONFIG.FIRST_DATA_ROW + CONFIG.MAX_ROWS - 1);

  if (end < CONFIG.FIRST_DATA_ROW) return;

  const count = end - CONFIG.FIRST_DATA_ROW + 1;
  const skus = s.getRange(CONFIG.FIRST_DATA_ROW, 1, count, 1).getDisplayValues();

  for (let i = 0; i < count; i++) {
    const row = CONFIG.FIRST_DATA_ROW + i;

    if (!skus[i][0]) continue;

    s.getRange(row, 12).setFormula(
      '=IF(A' + row + '="","",I' + row +
      '+J' + row +
      '+SUMIF(\'Stock Adjustments\'!$C$5:$C$2004,A' + row +
      ',\'Stock Adjustments\'!$D$5:$D$2004)' +
      '-K' + row + ')'
    );

    s.getRange(row, 17).setFormula(
      '=IF(A' + row + '="","",IF(L' + row +
      '<=0,"OUT OF STOCK",IF(L' + row +
      '<=P' + row + ',"LOW STOCK","IN STOCK")))'
    );
  }

  SpreadsheetApp.flush();
}

/* ========== DASHBOARD DATA ========== */

function bootstrap_() {
  // Refresh stock formulas for existing products.
  applyInventoryFormulas_();

  const products = readTable_(sheet_("Products"), 20);
  const sales = readTable_(sheet_("Sales"), 16);
  const stock = readTable_(sheet_("Stock In"), 7);
  const stockAdjustments = readTable_(sheet_("Stock Adjustments"), 6);
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

  return {
    dashboard,
    products,
    sales,
    stock,
    stockAdjustments,
    expenses,
    misc
  };
}

function readTable_(s, cols) {
  const last = Math.max(s.getLastRow(), CONFIG.HEADER_ROW);

  if (last < CONFIG.FIRST_DATA_ROW) return [];

  const values = s.getRange(
    CONFIG.HEADER_ROW,
    1,
    last - CONFIG.HEADER_ROW + 1,
    cols
  ).getDisplayValues();

  const headers = values.shift();

  return values
    .filter(r => r.some(x => x !== ""))
    .map(r => {
      const o = {};
      headers.forEach((h, i) => o[h] = r[i]);
      return o;
    });
}

/* ========== PRODUCTS ========== */

function addProduct_(r) {
  return withLock_(() => {
    const s = sheet_("Products");
    const sku = String(required_(r.sku, "SKU")).trim();

    const existing = s.getRange(
      CONFIG.FIRST_DATA_ROW, 1, CONFIG.MAX_ROWS, 1
    ).getDisplayValues().flat();

    if (existing.includes(sku)) throw new Error("That SKU already exists.");

    const row = nextRow_(s, 1);

    s.getRange(row, 1, 1, 9).setValues([[
      sku,
      required_(r.name, "Product name"),
      r.category || "",
      r.colour || "",
      r.size || "",
      r.supplier || "",
      number_(r.unitCost, "Unit cost", true),
      number_(r.sellingPrice, "Selling price", true),
      number_(r.openingStock || 0, "Opening stock", true)
    ]]);

    s.getRange(row, 16).setValue(
      number_(r.reorderLevel || 0, "Reorder level", true)
    );

    s.getRange(row, 20).setValue(r.imageUrl || "");

    copyProductFormulas_(s, row);

    // Apply the new inventory formulas to this product.
    setInventoryFormulas_(s, row);

    SpreadsheetApp.flush();

    return { message: "Product added", sku };
  });
}

function copyProductFormulas_(s, row) {
  const template = row > CONFIG.FIRST_DATA_ROW
    ? row - 1
    : CONFIG.FIRST_DATA_ROW;

  [10, 11, 12, 13, 14, 15, 17, 18, 19].forEach(c => {
    const f = s.getRange(template, c).getFormulaR1C1();
    if (f) s.getRange(row, c).setFormulaR1C1(f);
  });
}

function setInventoryFormulas_(s, row) {
  s.getRange(row, 12).setFormula(
    '=IF(A' + row + '="","",I' + row +
    '+J' + row +
    '+SUMIF(\'Stock Adjustments\'!$C$5:$C$2004,A' + row +
    ',\'Stock Adjustments\'!$D$5:$D$2004)' +
    '-K' + row + ')'
  );

  s.getRange(row, 17).setFormula(
    '=IF(A' + row + '="","",IF(L' + row +
    '<=0,"OUT OF STOCK",IF(L' + row +
    '<=P' + row + ',"LOW STOCK","IN STOCK")))'
  );
}

function updateProduct_(r) {
  return withLock_(() => {
    const s = sheet_("Products");
    const sku = String(required_(r.sku, "SKU")).trim();
    const row = findRowByValue_(s, 1, sku);

    if (row < 0) throw new Error("Product not found.");

    s.getRange(row, 2, 1, 8).setValues([[
      required_(r.name, "Product name"),
      r.category || "",
      r.colour || "",
      r.size || "",
      r.supplier || "",
      number_(r.unitCost, "Unit cost", true),
      number_(r.sellingPrice, "Selling price", true),
      number_(r.openingStock || 0, "Opening stock", true)
    ]]);

    s.getRange(row, 16).setValue(
      number_(r.reorderLevel || 0, "Reorder level", true)
    );

    if (r.imageUrl !== undefined && r.imageUrl !== null) {
      s.getRange(row, 20).setValue(r.imageUrl);
    }

    setInventoryFormulas_(s, row);

    SpreadsheetApp.flush();

    return { message: "Product updated.", sku };
  });
}

function deleteProduct_(r) {
  return withLock_(() => {
    const sku = String(required_(r.sku, "SKU")).trim();

    const sales = sheet_("Sales");
    const stock = sheet_("Stock In");
    const adjustments = sheet_("Stock Adjustments");

    if (findRowByValue_(sales, 5, sku) >= 0) {
      throw new Error("This product has sales history. It cannot be deleted.");
    }

    if (findRowByValue_(stock, 3, sku) >= 0) {
      throw new Error("This product has stock purchase history. It cannot be deleted.");
    }

    if (findRowByValue_(adjustments, 3, sku) >= 0) {
      throw new Error("This product has stock adjustment history. It cannot be deleted.");
    }

    const s = sheet_("Products");
    const row = findRowByValue_(s, 1, sku);

    return deleteRowChecked_(s, row);
  });
}

/* ========== SALES ========== */

function addSale_(r) {
  return withLock_(() => {
    const s = sheet_("Sales");
    const row = nextRow_(s, 1);
    const qty = number_(r.quantity, "Quantity", false);
    const sku = String(required_(r.sku, "SKU")).trim();

    if (!productExists_(sku)) throw new Error("SKU not found in Products.");

    s.getRange(row, 1, 1, 5).setValues([[
      required_(r.orderId, "Order ID"),
      dateValue_(r.orderDate),
      r.channel || "Instagram",
      r.customer || "",
      sku
    ]]);

    s.getRange(row, 7, 1, 4).setValues([[
      qty,
      number_(r.sellingPrice, "Selling price", true),
      number_(r.discount || 0, "Discount", true),
      r.status || "Confirmed"
    ]]);

    s.getRange(row, 15, 1, 2).setValues([[
      r.paymentStatus || "Pending",
      r.notes || ""
    ]]);

    copySaleFormulas_(s, row);
    SpreadsheetApp.flush();

    return { message: "Sale recorded", orderId: r.orderId };
  });
}

function copySaleFormulas_(s, row) {
  const template = row > CONFIG.FIRST_DATA_ROW
    ? row - 1
    : CONFIG.FIRST_DATA_ROW;

  [6, 11, 12, 13, 14].forEach(c => {
    const f = s.getRange(template, c).getFormulaR1C1();
    if (f) s.getRange(row, c).setFormulaR1C1(f);
  });
}

function updateSale_(r) {
  return withLock_(() => {
    const s = sheet_("Sales");
    const orderId = String(required_(r.orderId, "Order ID")).trim();
    const sku = String(required_(r.sku, "SKU")).trim();

    const row = findRecordRow_(s, { orderId, sku }, [
      { col: 1, key: "orderId" },
      { col: 5, key: "sku" }
    ]);

    if (row < 0) throw new Error("Sale record not found.");

    s.getRange(row, 1, 1, 5).setValues([[
      orderId,
      dateValue_(r.orderDate),
      r.channel || "",
      r.customer || "",
      sku
    ]]);

    s.getRange(row, 7, 1, 4).setValues([[
      number_(r.quantity, "Quantity", false),
      number_(r.sellingPrice, "Selling price", true),
      number_(r.discount || 0, "Discount", true),
      r.status || "Confirmed"
    ]]);

    s.getRange(row, 15, 1, 2).setValues([[
      r.paymentStatus || "Pending",
      r.notes || ""
    ]]);

    SpreadsheetApp.flush();

    return { message: "Sale updated." };
  });
}

function deleteSale_(r) {
  return withLock_(() => {
    const s = sheet_("Sales");
    const row = findRecordRow_(s, r, [
      { col: 1, key: "orderId" },
      { col: 5, key: "sku" }
    ]);

    return deleteRowChecked_(s, row);
  });
}

/* ========== STOCK PURCHASES ========== */

function addStock_(r) {
  return withLock_(() => {
    const sku = String(required_(r.sku, "SKU")).trim();

    if (!productExists_(sku)) throw new Error("SKU not found in Products.");

    const s = sheet_("Stock In");
    const row = nextRow_(s, 1);

    s.getRange(row, 1, 1, 7).setValues([[
      dateValue_(r.date),
      r.reference || ("STK-" + new Date().getTime()),
      sku,
      number_(r.quantity, "Quantity", false),
      number_(r.unitCost, "Unit cost", true),
      r.supplier || "",
      r.notes || ""
    ]]);

    SpreadsheetApp.flush();

    return { message: "Stock purchase recorded" };
  });
}

function updateStock_(r) {
  return withLock_(() => {
    const s = sheet_("Stock In");
    const ref = String(required_(r.reference, "Stock reference")).trim();
    const row = findRowByValue_(s, 2, ref);

    if (row < 0) throw new Error("Stock purchase not found.");

    const sku = String(required_(r.sku, "SKU")).trim();
    if (!productExists_(sku)) throw new Error("SKU not found in Products.");

    s.getRange(row, 1, 1, 7).setValues([[
      dateValue_(r.date),
      ref,
      sku,
      number_(r.quantity, "Quantity", false),
      number_(r.unitCost, "Unit cost", true),
      r.supplier || "",
      r.notes || ""
    ]]);

    SpreadsheetApp.flush();

    return { message: "Stock purchase updated." };
  });
}

function deleteStock_(r) {
  return withLock_(() => {
    const s = sheet_("Stock In");
    const row = findRowByValue_(
      s, 2, required_(r.reference, "Stock reference")
    );

    return deleteRowChecked_(s, row);
  });
}

/* ========== STOCK ADJUSTMENTS ========== */

function addStockAdjustment_(r) {
  return withLock_(() => {
    const sku = String(required_(r.sku, "SKU")).trim();

    if (!productExists_(sku)) {
      throw new Error("SKU not found in Products.");
    }

    const s = sheet_("Stock Adjustments");
    const row = nextRow_(s, 1);

    const reference = String(
      r.reference || ("ADJ-" + new Date().getTime())
    ).trim();

    if (findRowByValue_(s, 2, reference) >= 0) {
      throw new Error("That adjustment reference already exists.");
    }

    s.getRange(row, 1, 1, 6).setValues([[
      dateValue_(r.date),
      reference,
      sku,
      adjustmentQuantity_(r.quantityChange),
      required_(r.reason, "Adjustment reason"),
      r.notes || ""
    ]]);

    SpreadsheetApp.flush();

    return {
      message: "Stock adjustment recorded.",
      reference,
      sku
    };
  });
}

function updateStockAdjustment_(r) {
  return withLock_(() => {
    const s = sheet_("Stock Adjustments");
    const reference = String(
      required_(r.reference, "Adjustment reference")
    ).trim();

    const row = findRowByValue_(s, 2, reference);

    if (row < 0) throw new Error("Stock adjustment not found.");

    const sku = String(required_(r.sku, "SKU")).trim();

    if (!productExists_(sku)) {
      throw new Error("SKU not found in Products.");
    }

    s.getRange(row, 1, 1, 6).setValues([[
      dateValue_(r.date),
      reference,
      sku,
      adjustmentQuantity_(r.quantityChange),
      required_(r.reason, "Adjustment reason"),
      r.notes || ""
    ]]);

    SpreadsheetApp.flush();

    return { message: "Stock adjustment updated.", reference };
  });
}

function deleteStockAdjustment_(r) {
  return withLock_(() => {
    const s = sheet_("Stock Adjustments");
    const reference = required_(r.reference, "Adjustment reference");
    const row = findRowByValue_(s, 2, reference);

    return deleteRowChecked_(s, row);
  });
}

/* ========== EXPENSES ========== */

function addExpense_(r) {
  const s = sheet_("Expenses");
  const row = nextRow_(s, 1);

  s.getRange(row, 1, 1, 6).setValues([[
    dateValue_(r.date),
    required_(r.type, "Expense type"),
    required_(r.description, "Description"),
    r.relatedOrder || "",
    number_(r.amount, "Amount", false),
    r.notes || ""
  ]]);

  return { message: "Expense recorded" };
}

function updateExpense_(r) {
  return withLock_(() => {
    const s = sheet_("Expenses");

    const row = findRecordRow_(s, r, [
      { col: 1, key: "originalDate" },
      { col: 2, key: "originalType" },
      { col: 3, key: "originalDescription" },
      { col: 5, key: "originalAmount" }
    ]);

    if (row < 0) throw new Error("Expense record not found.");

    s.getRange(row, 1, 1, 6).setValues([[
      dateValue_(r.date),
      required_(r.type, "Expense type"),
      required_(r.description, "Description"),
      r.relatedOrder || "",
      number_(r.amount, "Amount", false),
      r.notes || ""
    ]]);

    SpreadsheetApp.flush();

    return { message: "Expense updated." };
  });
}

function deleteExpense_(r) {
  return withLock_(() => {
    const s = sheet_("Expenses");

    const row = findRecordRow_(s, r, [
      { col: 1, key: "originalDate" },
      { col: 2, key: "originalType" },
      { col: 3, key: "originalDescription" },
      { col: 5, key: "originalAmount" }
    ]);

    return deleteRowChecked_(s, row);
  });
}

/* ========== MISCELLANEOUS COSTS ========== */

function addMisc_(r) {
  const s = sheet_("Miscellaneous");
  const row = nextRow_(s, 1);

  const qty = r.quantity === "" || r.quantity === null || r.quantity === undefined
    ? ""
    : number_(r.quantity, "Quantity", false);

  const unit = r.unitCost === "" || r.unitCost === null || r.unitCost === undefined
    ? ""
    : number_(r.unitCost, "Unit cost", true);

  if (qty === "" && unit === "") {
    throw new Error("Enter a unit cost, or both quantity and unit cost.");
  }

  s.getRange(row, 1, 1, 5).setValues([[
    dateValue_(r.date),
    required_(r.category, "Category"),
    required_(r.description, "Description"),
    qty,
    unit
  ]]);

  const template = row > CONFIG.FIRST_DATA_ROW
    ? row - 1
    : CONFIG.FIRST_DATA_ROW;

  const f = s.getRange(template, 6).getFormulaR1C1();

  if (f) {
    s.getRange(row, 6).setFormulaR1C1(f);
  } else {
    s.getRange(row, 6).setFormula(
      '=IF(COUNTA(B' + row + ':E' + row +
      ')=0,"",IF(OR(D' + row + '="",E' + row +
      '=""),IF(E' + row + '="",0,E' + row +
      '),D' + row + '*E' + row + '))'
    );
  }

  SpreadsheetApp.flush();

  return { message: "Miscellaneous cost recorded" };
}

function updateMisc_(r) {
  return withLock_(() => {
    const s = sheet_("Miscellaneous");

    const row = findRecordRow_(s, r, [
      { col: 1, key: "originalDate" },
      { col: 2, key: "originalCategory" },
      { col: 3, key: "originalDescription" }
    ]);

    if (row < 0) throw new Error("Miscellaneous record not found.");

    const qty = r.quantity === "" || r.quantity == null
      ? ""
      : number_(r.quantity, "Quantity", false);

    const unit = r.unitCost === "" || r.unitCost == null
      ? ""
      : number_(r.unitCost, "Unit cost", true);

    s.getRange(row, 1, 1, 5).setValues([[
      dateValue_(r.date),
      required_(r.category, "Category"),
      required_(r.description, "Description"),
      qty,
      unit
    ]]);

    SpreadsheetApp.flush();

    return { message: "Miscellaneous cost updated." };
  });
}

function deleteMisc_(r) {
  return withLock_(() => {
    const s = sheet_("Miscellaneous");

    const row = findRecordRow_(s, r, [
      { col: 1, key: "originalDate" },
      { col: 2, key: "originalCategory" },
      { col: 3, key: "originalDescription" }
    ]);

    return deleteRowChecked_(s, row);
  });
}

/* ========== CRUD HELPERS ========== */

function productExists_(sku) {
  return sheet_("Products")
    .getRange(CONFIG.FIRST_DATA_ROW, 1, CONFIG.MAX_ROWS, 1)
    .getDisplayValues()
    .flat()
    .includes(sku);
}

function findRowByValue_(s, column, value) {
  const last = s.getLastRow();

  if (last < CONFIG.FIRST_DATA_ROW) return -1;

  const values = s.getRange(
    CONFIG.FIRST_DATA_ROW,
    column,
    last - CONFIG.FIRST_DATA_ROW + 1,
    1
  ).getDisplayValues().flat();

  const index = values.findIndex(
    v => String(v).trim() === String(value).trim()
  );

  return index === -1 ? -1 : CONFIG.FIRST_DATA_ROW + index;
}

function findRecordRow_(s, record, columns) {
  const last = s.getLastRow();

  if (last < CONFIG.FIRST_DATA_ROW) return -1;

  const count = last - CONFIG.FIRST_DATA_ROW + 1;

  const rows = s.getRange(
    CONFIG.FIRST_DATA_ROW,
    1,
    count,
    s.getLastColumn()
  ).getDisplayValues();

  const index = rows.findIndex(row =>
    columns.every(c =>
      String(row[c.col - 1]).trim() ===
      String(record[c.key] ?? "").trim()
    )
  );

  return index === -1 ? -1 : CONFIG.FIRST_DATA_ROW + index;
}

function deleteRowChecked_(s, row) {
  if (row < CONFIG.FIRST_DATA_ROW) {
    throw new Error("Record not found.");
  }

  s.deleteRow(row);
  SpreadsheetApp.flush();

  return { message: "Record deleted." };
}
