
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

let token = sessionStorage.getItem("lot_token") || "";

let data = {
  dashboard: {},
  products: [],
  sales: [],
  stock: [],
  stockAdjustments: [],
  expenses: [],
  misc: []
};

const today = new Date().toISOString().slice(0, 10);

const money = v =>
  "₹" + (Number(String(v || 0).replace(/[₹,]/g, "")) || 0)
    .toLocaleString("en-IN", { maximumFractionDigits: 2 });

const val = (o, key) => o[key] ?? "";

function notify(message, bad = false) {
  const n = $("#notice");
  n.textContent = message;
  n.classList.remove("hidden", "bad");

  if (bad) n.classList.add("bad");

  window.scrollTo({ top: 0, behavior: "smooth" });

  setTimeout(() => n.classList.add("hidden"), 4500);
}

async function api(action, record = {}) {
  const res = await fetch("/.netlify/functions/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, record, token })
  });

  const out = await res.json();

  if (!res.ok || !out.ok) {
    throw new Error(out.error || "Request failed.");
  }

  return out.data;
}

async function login(password) {
  const res = await fetch("/.netlify/functions/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login", password })
  });

  const out = await res.json();

  if (!res.ok) throw new Error(out.error || "Login failed.");

  token = out.token;
  sessionStorage.setItem("lot_token", token);
}

function showApp() {
  $("#loginView").classList.add("hidden");
  $("#appView").classList.remove("hidden");
}

function showLogin() {
  $("#appView").classList.add("hidden");
  $("#loginView").classList.remove("hidden");
}

async function load() {
  try {
    data = await api("bootstrap");

    // Compatibility with existing bootstrap responses.
    data.stockAdjustments = data.stockAdjustments || [];

    render();

    $("#lastSync").textContent =
      "Synced " +
      new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      });

  } catch (e) {
    if (/session expired|unauthorized/i.test(e.message)) {
      token = "";
      sessionStorage.removeItem("lot_token");
      showLogin();
    }

    notify(e.message, true);
  }
}

/* ========== RENDER ========== */

function render() {
  const d = data.dashboard || {};

  const cards = [
    ["Products / variants", d.productCount, "Unique catalogue SKUs"],
    ["Units available", d.availableUnits, "Across all variants"],
    ["Units sold", d.unitsSold, "Confirmed, shipped & delivered"],
    ["Low-stock variants", d.lowStock, "At or below reorder level"],
    ["Net sales", money(d.netSales), "After discounts"],
    ["Gross profit", money(d.grossProfit), "Before operating expenses"],
    ["Stock investment", money(d.stockInvestment), "Recorded purchase investment"],
    ["Tracked expenses", money(d.totalExpenses), "Business + miscellaneous"]
  ];

  $("#stats").innerHTML = cards.map(c => `
    <div class="stat">
      <label>${c[0]}</label>
      <strong>${c[1] ?? "—"}</strong>
      <small>${c[2]}</small>
    </div>
  `).join("");

  const low = data.products.filter(p => {
    const status = String(p["Stock Status"] || "").toUpperCase();
    return status === "LOW STOCK" || status === "RESTOCK";
  });

  $("#lowStock").innerHTML = low.length
    ? low.slice(0, 7).map(p => `
      <div class="low-row">
        <span>
          <b>${esc(val(p, "SKU (unique)"))}</b>
          · ${esc(val(p, "Product Name"))}
          <span class="pill warn">${esc(val(p, "Stock Status"))}</span>
        </span>
        <span>${esc(val(p, "Available Stock"))} left</span>
      </div>
    `).join("")
    : '<div class="empty">All good — no products currently need restocking.</div>';

  $("#recentSales").innerHTML = table(
    data.sales.slice(-6).reverse(),
    [
      "Order ID",
      "Order Date",
      "Customer / Handle",
      "SKU",
      "Quantity",
      "Net Sales (₹)",
      "Order Status"
    ]
  );

  $("#productsTable").innerHTML = table(
    data.products,
    [
      "SKU (unique)",
      "Product Name",
      "Category",
      "Colour",
      "Size",
      "Unit Cost (₹)",
      "Selling Price (₹)",
      "Available Stock",
      "Stock Status",
      "Total Purchase Investment (₹)"
    ],
    "products"
  );

  $("#salesTable").innerHTML = table(
    data.sales.slice().reverse(),
    [
      "Order ID",
      "Order Date",
      "Sales Channel",
      "Customer / Handle",
      "SKU",
      "Quantity",
      "Net Sales (₹)",
      "Order Status",
      "Payment Status"
    ],
    true
  );

  $("#stockTable").innerHTML = table(
    data.stock.slice().reverse(),
    [
      "Date",
      "Stock-In Reference",
      "SKU",
      "Quantity Added",
      "Unit Cost (₹)",
      "Supplier"
    ]
  );

  $("#expensesTable").innerHTML = table(
    data.expenses.slice().reverse(),
    [
      "Date",
      "Expense Type",
      "Description",
      "Related Order (optional)",
      "Amount (₹)",
      "Notes"
    ]
  );

  $("#miscTable").innerHTML = table(
    data.misc.slice().reverse(),
    [
      "Date",
      "Expense Category",
      "Description / Item",
      "Quantity (optional)",
      "Unit Cost (₹)",
      "Total Cost (₹)"
    ]
  );

  renderStockAdjustments();

  const options = data.products.map(p => `
    <option value="${attr(val(p, "SKU (unique)"))}">
      ${esc(val(p, "SKU (unique)"))} —
      ${esc(val(p, "Product Name"))} /
      ${esc(val(p, "Colour"))} /
      ${esc(val(p, "Size"))}
    </option>
  `).join("");

  $("#saleSku").innerHTML =
    '<option value="">Choose a product</option>' + options;

  $$(".skuSelect").forEach(el => {
    el.innerHTML = '<option value="">Choose a product</option>' + options;
  });

  const adjustmentSku = $("#adjustmentSku");

  if (adjustmentSku) {
    const selected = adjustmentSku.value;

    adjustmentSku.innerHTML =
      '<option value="">Choose a product</option>' + options;

    if (selected) adjustmentSku.value = selected;
  }
}

function table(rows, headers, module = "") {
  if (!rows?.length) {
    return '<div class="empty">No records yet. Add your first entry to get started.</div>';
  }

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            ${headers.map(h => `
              <th>${esc(h.replace(" (₹)", ""))}</th>
            `).join("")}
            ${module ? "<th>Actions</th>" : ""}
          </tr>
        </thead>

        <tbody>
          ${rows.map(r => {
            const sku = val(r, "SKU (unique)");

            return `
              <tr>
                ${headers.map(h => `
                  <td>
                    ${h.includes("SKU")
                      ? `<span class="sku">${esc(val(r, h))}</span>`
                      : h.includes("Status")
                        ? `<span class="pill">${esc(val(r, h))}</span>`
                        : esc(val(r, h))}
                  </td>
                `).join("")}

                ${module === "products" ? `
                  <td class="actions">
                    <button class="text-btn edit-product" data-sku="${attr(sku)}">Edit</button>
                    <button class="text-btn delete-product" data-sku="${attr(sku)}">Delete</button>
                  </td>
                ` : ""}
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

/* ========== STOCK ADJUSTMENTS UI ========== */

function setupStockAdjustmentsUI() {
  // Add the new sidebar navigation item.
  if (!$("#stockAdjustmentsNav")) {
    const nav = $("#nav");

    const button = document.createElement("button");
    button.id = "stockAdjustmentsNav";
    button.className = "nav-item";
    button.dataset.page = "stockAdjustments";
    button.textContent = "Stock Adjustments";

    nav.appendChild(button);
  }

  // Add the new page alongside existing pages.
  if (!$("#stockAdjustmentsPage")) {
    const pageHost =
      $("#overviewPage")?.parentElement ||
      $("#productsPage")?.parentElement ||
      $("#appView");

    const page = document.createElement("section");

    page.id = "stockAdjustmentsPage";
    page.className = "page hidden";

    page.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:20px;">
        <div>
          <h2>Stock Adjustments</h2>
          <p>Correct your inventory when physical stock differs from recorded stock.</p>
        </div>

        <button type="button" class="primary" id="addStockAdjustmentBtn">
          + Add adjustment
        </button>
      </div>

      <div class="stat" style="margin-bottom:20px;">
        <label>Total adjustments recorded</label>
        <strong id="adjustmentCount">0</strong>
        <small>Positive values add stock. Negative values reduce stock.</small>
      </div>

      <div id="stockAdjustmentsTable"></div>
    `;

    pageHost.appendChild(page);
  }

  // Create the adjustment form modal.
  if (!$("#stockAdjustmentModal")) {
    const dialog = document.createElement("dialog");

    dialog.id = "stockAdjustmentModal";

    dialog.innerHTML = `
      <form id="stockAdjustmentForm" class="form-grid">

        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
          <h2 id="adjustmentModalTitle">Add stock adjustment</h2>
          <button type="button" class="text-btn" data-close>Close</button>
        </div>

        <input type="hidden" name="reference">

        <label>
          Adjustment date
          <input type="date" name="date" required>
        </label>

        <label>
          Product / SKU
          <select name="sku" id="adjustmentSku" class="skuSelect" required>
            <option value="">Choose a product</option>
          </select>
        </label>

        <label>
          Quantity change
          <input
            type="number"
            name="quantityChange"
            step="1"
            required
            placeholder="Example: 5 or -2"
          >
          <small>Use a positive number to add stock and a negative number to reduce stock.</small>
        </label>

        <label>
          Reason
          <select name="reason" required>
            <option value="">Choose a reason</option>
            <option value="Physical count correction">Physical count correction</option>
            <option value="Damaged item">Damaged item</option>
            <option value="Lost/missing item">Lost/missing item</option>
            <option value="Found stock">Found stock</option>
            <option value="Other">Other</option>
          </select>
        </label>

        <label>
          Notes
          <textarea name="notes" rows="3" placeholder="Optional notes"></textarea>
        </label>

        <button type="submit" class="primary" id="saveAdjustmentBtn">
          Save adjustment
        </button>

      </form>
    `;

    document.body.appendChild(dialog);
  }
}

function renderStockAdjustments() {
  const rows = data.stockAdjustments || [];

  const count = $("#adjustmentCount");
  if (count) count.textContent = rows.length;

  const container = $("#stockAdjustmentsTable");
  if (!container) return;

  if (!rows.length) {
    container.innerHTML = `
      <div class="empty">
        No stock adjustments recorded yet. Add your first adjustment to get started.
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Reference</th>
            <th>SKU</th>
            <th>Quantity change</th>
            <th>Reason</th>
            <th>Notes</th>
            <th>Actions</th>
          </tr>
        </thead>

        <tbody>
          ${rows.slice().reverse().map(r => {
            const reference = val(r, "Adjustment Reference");
            const quantity = Number(
              String(val(r, "Quantity Change")).replace(/,/g, "")
            ) || 0;

            return `
              <tr>
                <td>${esc(val(r, "Date"))}</td>
                <td>${esc(reference)}</td>
                <td><span class="sku">${esc(val(r, "SKU"))}</span></td>
                <td>
                  <span class="pill ${quantity < 0 ? "warn" : ""}">
                    ${quantity > 0 ? "+" : ""}${quantity}
                  </span>
                </td>
                <td>${esc(val(r, "Reason"))}</td>
                <td>${esc(val(r, "Notes"))}</td>
                <td class="actions">
                  <button
                    class="text-btn edit-stock-adjustment"
                    data-reference="${attr(reference)}"
                  >Edit</button>

                  <button
                    class="text-btn delete-stock-adjustment"
                    data-reference="${attr(reference)}"
                  >Delete</button>
                </td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function resetAdjustmentForm() {
  const form = $("#stockAdjustmentForm");

  form.reset();
  form.elements.date.value = today;
  form.elements.reference.value = "";

  delete form.dataset.editing;

  $("#adjustmentModalTitle").textContent = "Add stock adjustment";
  $("#saveAdjustmentBtn").textContent = "Save adjustment";
}

function dateForInput(value) {
  if (!value) return today;

  const str = String(value).trim();

  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str.slice(0, 10);
  }

  const match = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);

  if (match) {
    return [
      match[3],
      match[2].padStart(2, "0"),
      match[1].padStart(2, "0")
    ].join("-");
  }

  const parsed = new Date(str);

  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return today;
}

function openAdjustmentForm() {
  resetAdjustmentForm();
  $("#stockAdjustmentModal").showModal();
}

async function editStockAdjustment(reference) {
  const record = data.stockAdjustments.find(
    r => String(val(r, "Adjustment Reference")) === String(reference)
  );

  if (!record) {
    notify("Stock adjustment not found.", true);
    return;
  }

  const form = $("#stockAdjustmentForm");

  resetAdjustmentForm();

  form.elements.reference.value = reference;
  form.elements.date.value = dateForInput(val(record, "Date"));
  form.elements.sku.value = val(record, "SKU");

  form.elements.quantityChange.value =
    String(val(record, "Quantity Change")).replace(/,/g, "");

  form.elements.reason.value = val(record, "Reason");
  form.elements.notes.value = val(record, "Notes");

  form.dataset.editing = "true";

  $("#adjustmentModalTitle").textContent = "Edit stock adjustment";
  $("#saveAdjustmentBtn").textContent = "Update adjustment";

  $("#stockAdjustmentModal").showModal();
}

async function deleteStockAdjustment(reference) {
  if (!confirm(`Delete stock adjustment ${reference}?`)) return;

  try {
    await api("deleteStockAdjustment", { reference });

    await load();

    notify("Stock adjustment deleted successfully.");

  } catch (error) {
    notify(error.message, true);
  }
}

async function saveStockAdjustment(e) {
  e.preventDefault();

  const form = e.target;
  const button = $("#saveAdjustmentBtn");
  const editing = form.dataset.editing === "true";

  const payload = formObject(form);

  button.disabled = true;
  button.textContent = editing ? "Updating..." : "Saving...";

  try {
    // Validate quantity as a non-zero whole number.
    const quantity = Number(payload.quantityChange);

    if (!Number.isInteger(quantity) || quantity === 0) {
      throw new Error("Quantity change must be a non-zero whole number.");
    }

    if (editing) {
      await api("updateStockAdjustment", payload);
    } else {
      await api("addStockAdjustment", payload);
    }

    $("#stockAdjustmentModal").close();

    resetAdjustmentForm();

    await load();

    notify(
      editing
        ? "Stock adjustment updated successfully."
        : "Stock adjustment recorded successfully. Inventory updated."
    );

  } catch (error) {
    notify(error.message, true);

  } finally {
    button.disabled = false;

    button.textContent = editing
      ? "Update adjustment"
      : "Save adjustment";
  }
}

/* ========== GENERAL HELPERS ========== */

function esc(x) {
  return String(x ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

function attr(x) {
  return esc(x).replace(/`/g, "&#96;");
}

function go(page) {
  $$(".page").forEach(p => p.classList.add("hidden"));

  const target = $("#" + page + "Page");

  if (!target) return;

  target.classList.remove("hidden");

  $$(".nav-item").forEach(n => {
    n.classList.toggle("active", n.dataset.page === page);
  });

  const names = {
    overview: ["YOUR BUSINESS AT A GLANCE", "Overview"],
    products: ["YOUR CATALOGUE", "Products"],
    sales: ["ORDERS & REVENUE", "Sales"],
    stock: ["INVENTORY IN", "Stock purchases"],
    stockAdjustments: ["INVENTORY CORRECTIONS", "Stock Adjustments"],
    expenses: ["RUNNING THE BUSINESS", "Expenses"],
    misc: ["THE LITTLE THINGS ADD UP", "Miscellaneous costs"]
  };

  $("#pageEyebrow").textContent = names[page][0];
  $("#pageTitle").textContent = names[page][1];
}

function formObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function resetProductForm() {
  const form = $("#productForm");

  form.reset();
  form.elements.sku.readOnly = false;

  delete form.dataset.editing;
  delete form.dataset.originalSku;

  $("#productModal").querySelector("h2").textContent =
    "Add product / variant";

  form.querySelector("button.primary").textContent =
    "Save product";
}

async function submitForm(form, action) {
  const button = form.querySelector("button.primary");

  button.disabled = true;
  button.textContent = "Saving…";

  try {
    await api(action, formObject(form));

    form.reset();

    form.querySelectorAll('input[type="date"]').forEach(i => {
      i.value = today;
    });

    form.closest("dialog").close();

    await load();

    notify("Saved successfully. Your Google Sheet has been updated.");

  } catch (e) {
    notify(e.message, true);

  } finally {
    button.disabled = false;

    button.textContent = ({
      addProduct: "Save product",
      addSale: "Save sale",
      addStock: "Save stock purchase",
      addExpense: "Save expense",
      addMisc: "Save cost"
    })[action];
  }
}

/* ========== LOGIN ========== */

$("#loginForm").addEventListener("submit", async e => {
  e.preventDefault();

  $("#loginError").textContent = "";

  try {
    await login($("#password").value);

    showApp();

    await load();

  } catch (err) {
    $("#loginError").textContent = err.message;
  }
});

$("#logoutBtn").onclick = () => {
  token = "";
  sessionStorage.removeItem("lot_token");
  showLogin();
};

$("#refreshBtn").onclick = load;

/* ========== NAVIGATION ========== */

$("#nav").addEventListener("click", e => {
  const b = e.target.closest("[data-page]");

  if (b) go(b.dataset.page);
});

/* ========== GLOBAL CLICK HANDLER ========== */

document.addEventListener("click", e => {
  const m = e.target.closest("[data-modal]");

  if (m) {
    const d = $("#" + m.dataset.modal);

    if (m.dataset.modal === "productModal") {
      resetProductForm();
    }

    d.querySelectorAll('input[type="date"]').forEach(i => {
      i.value = today;
    });

    d.showModal();
  }

  if (e.target.matches("[data-close]")) {
    e.target.closest("dialog").close();
  }

  const g = e.target.closest("[data-goto]");

  if (g) go(g.dataset.goto);

  const u = e.target.closest(".update-sale");

  if (u) updateSale(u.dataset.order);

  if (e.target.closest("#addStockAdjustmentBtn")) {
    openAdjustmentForm();
  }

  const editAdjustment = e.target.closest(".edit-stock-adjustment");

  if (editAdjustment) {
    editStockAdjustment(editAdjustment.dataset.reference);
  }

  const deleteAdjustment = e.target.closest(".delete-stock-adjustment");

  if (deleteAdjustment) {
    deleteStockAdjustment(deleteAdjustment.dataset.reference);
  }
});

/* ========== PRODUCT FORM ========== */

$("#productForm").onsubmit = async e => {
  e.preventDefault();

  const form = e.target;
  const editing = form.dataset.editing === "true";
  const button = form.querySelector("button.primary");

  const payload = formObject(form);

  if (editing) {
    payload.sku = form.dataset.originalSku;
  }

  button.disabled = true;
  button.textContent = editing ? "Updating…" : "Saving…";

  try {
    await api(editing ? "updateProduct" : "addProduct", payload);

    $("#productModal").close();

    resetProductForm();

    await load();

    notify(
      editing
        ? "Product updated successfully."
        : "Product added successfully."
    );

  } catch (error) {
    notify(error.message, true);

  } finally {
    button.disabled = false;
  }
};

/* ========== OTHER FORMS ========== */

$("#saleForm").onsubmit = e => {
  e.preventDefault();
  submitForm(e.target, "addSale");
};

$("#stockForm").onsubmit = e => {
  e.preventDefault();
  submitForm(e.target, "addStock");
};

$("#expenseForm").onsubmit = e => {
  e.preventDefault();
  submitForm(e.target, "addExpense");
};

$("#miscForm").onsubmit = e => {
  e.preventDefault();
  submitForm(e.target, "addMisc");
};

/* ========== STOCK ADJUSTMENT FORM ========== */

$("#stockAdjustmentForm").addEventListener(
  "submit",
  saveStockAdjustment
);

/* ========== PRODUCT SEARCH ========== */

$("#productSearch").addEventListener("input", e => {
  const q = e.target.value.toLowerCase();

  const filtered = data.products.filter(p =>
    Object.values(p).join(" ").toLowerCase().includes(q)
  );

  $("#productsTable").innerHTML = table(
    filtered,
    [
      "SKU (unique)",
      "Product Name",
      "Category",
      "Colour",
      "Size",
      "Unit Cost (₹)",
      "Selling Price (₹)",
      "Available Stock",
      "Stock Status",
      "Total Purchase Investment (₹)"
    ],
    "products"
  );
});

/* ========== SALES UPDATE ========== */

async function updateSale(orderId) {
  const current = data.sales.find(
    s => val(s, "Order ID") === orderId
  );

  if (!current) return;

  const status = prompt(
    "Order status (Confirmed, Shipped, Delivered, Cancelled, Returned):",
    val(current, "Order Status")
  );

  if (status === null) return;

  const payment = prompt(
    "Payment status (Pending, Paid, Partially Paid, Refunded):",
    val(current, "Payment Status")
  );

  if (payment === null) return;

  try {
    await api("updateSale", {
      orderId,
      status,
      paymentStatus: payment
    });

    await load();

    notify("Order updated.");

  } catch (e) {
    notify(e.message, true);
  }
}

/* ========== PRODUCT EDIT ========== */

async function editProduct(sku) {
  const product = data.products.find(
    p => val(p, "SKU (unique)") === sku
  );

  if (!product) return;

  const form = $("#productForm");

  const fields = {
    sku: "SKU (unique)",
    name: "Product Name",
    category: "Category",
    colour: "Colour",
    size: "Size",
    supplier: "Supplier",
    unitCost: "Unit Cost (₹)",
    sellingPrice: "Selling Price (₹)",
    openingStock: "Opening Stock",
    reorderLevel: "Reorder Level"
  };

  Object.entries(fields).forEach(([name, key]) => {
    const input = form.elements[name];

    if (input) input.value = val(product, key);
  });

  form.elements.sku.readOnly = true;

  form.dataset.editing = "true";
  form.dataset.originalSku = sku;

  form.querySelector("button.primary").textContent = "Update product";

  $("#productModal").querySelector("h2").textContent = "Edit product";

  $("#productModal").showModal();
}

async function deleteProduct(sku) {
  if (!confirm(`Are you sure you want to delete product ${sku}?`)) {
    return;
  }

  try {
    await api("deleteProduct", { sku });

    await load();

    notify("Product deleted successfully.");

  } catch (error) {
    notify(error.message, true);
  }
}

document.addEventListener("click", e => {
  const edit = e.target.closest(".edit-product");

  if (edit) editProduct(edit.dataset.sku);

  const del = e.target.closest(".delete-product");

  if (del) deleteProduct(del.dataset.sku);
});

/* ========== INITIALIZE ========== */

setupStockAdjustmentsUI();

if (token) {
  showApp();
  load();
} else {
  showLogin();
}
