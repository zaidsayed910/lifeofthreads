# Lifeofthreads Inventory Studio

A private Netlify-hosted web app connected to your existing Google Sheets inventory workbook through Google Apps Script.

## What it does

- Dashboard metrics and low-stock view
- Add product variants (one SKU per size/colour)
- Record sales and update order/payment status
- Record stock purchases with actual unit cost
- Add operating expenses and miscellaneous costs
- Refresh data from the Google Sheet

The Google Sheet remains the source of truth. This app writes new records into the existing tabs and lets the sheet's formulas calculate totals.

## Part 1 — Prepare your Google Sheet

1. Upload `Lifeofthreads_Inventory_Management_Updated.xlsx` to Google Drive.
2. Open it with Google Sheets and let formulas finish converting.
3. Confirm these tabs exist with the same names: `Dashboard`, `Products`, `Sales`, `Stock In`, `Expenses`, `Miscellaneous`.
4. Copy the spreadsheet ID from its URL:
   `https://docs.google.com/spreadsheets/d/YOUR_SPREADSHEET_ID/edit`

## Part 2 — Deploy the Apps Script

1. In that Google Sheet, choose **Extensions → Apps Script**.
2. Replace the editor contents with `google-apps-script/Code.gs`.
3. In Apps Script, open **Project Settings → Script Properties → Add script property**.
4. Add:
   - `SPREADSHEET_ID` = the ID copied from the Google Sheets URL
   - `API_KEY` = a long random secret (at least 32 characters). Generate one with a password manager.
5. Save the project.
6. Choose **Deploy → New deployment → Web app**.
7. Set **Execute as: Me**.
8. Set **Who has access: Anyone**. This is required so the Netlify server function can call it without a Google sign-in. The API key check in the script rejects requests that do not know the secret. Do not put the API key in the website files.
9. Deploy, authorise the requested Google permissions, and copy the Web app URL ending in `/exec`.

## Part 3 — Deploy the web app to Netlify

1. Create a private GitHub repository and upload the contents of this project folder, or drag the project folder into Netlify Drop for a first deploy.
2. In Netlify, open **Site configuration → Environment variables** and add:
   - `APPS_SCRIPT_URL` = your Apps Script `/exec` URL
   - `APPS_SCRIPT_API_KEY` = exactly the same secret as Apps Script `API_KEY`
   - `APP_PASSWORD` = a strong, unique password you will use to sign in
   - `SESSION_SECRET` = another long random secret, different from the API key
3. Trigger a redeploy after adding environment variables.
4. Open your Netlify site URL and sign in with `APP_PASSWORD`.

For updates, push changes to the GitHub repository; Netlify will redeploy automatically.

## Security notes

- The site has a password gate. Login sessions last 12 hours and are stored in the current browser tab's session storage.
- Google credentials and the Apps Script API key are only used by the Netlify server function, not sent to browser JavaScript.
- The Apps Script deployment is publicly reachable at the URL, but its POST actions require the API key. Keep that key private and rotate it if exposed.
- Do not share your Netlify site URL or password. For stronger protection, enable Netlify's site-level password/visitor access controls if available on your plan.
- This is intended for one owner, not multi-user staff permissions.

## Important behaviour / notes

- New product and sales entries copy the existing sheet formula pattern into the next free row.
- Sales that are Confirmed, Shipped or Delivered count as sold, matching the workbook's formulas.
- Cancelled and Returned orders do not contribute to sales revenue/product cost under the workbook formulas.
- Stock quantities are not blocked at save time if a sale exceeds available stock; check the inventory before confirming large orders.
- Existing rows are read from the sheet; this app currently adds records rather than deleting historical records.
- The dashboard reads the values calculated by the Dashboard sheet. If a formula cell is blank, check the corresponding formula in the sheet.
- If you rename tabs or change column order, update `Code.gs` and `app.js` to match.

## Troubleshooting

- **Netlify says environment variables are incomplete:** check all four variables and redeploy.
- **Unauthorized from Apps Script:** make sure `API_KEY` in Script Properties exactly matches `APPS_SCRIPT_API_KEY` in Netlify.
- **Missing sheet:** restore the exact tab name.
- **Changes do not appear immediately:** click Refresh; Apps Script runs the sheet formulas and returns current values.
