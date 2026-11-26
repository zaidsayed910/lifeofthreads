import crypto from "node:crypto";

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(body)
});
const secret = () => process.env.SESSION_SECRET || "";
function sign(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret()).update(data).digest("base64url");
  return `${data}.${sig}`;
}
function verify(token) {
  if (!token || !secret()) return false;
  const [data, sig] = token.split(".");
  if (!data || !sig) return false;
  const expected = crypto.createHmac("sha256", secret()).update(data).digest();
  let actual;
  try { actual = Buffer.from(sig, "base64url"); } catch { return false; }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return false;
  try {
    const p = JSON.parse(Buffer.from(data, "base64url").toString());
    return p.exp > Date.now();
  } catch { return false; }
}
export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  try {
    const body = await req.json();
    if (body.action === "login") {
      if (!process.env.APP_PASSWORD || body.password !== process.env.APP_PASSWORD) {
        return json(401, { error: "Incorrect password." });
      }
      const token = sign({ exp: Date.now() + 1000 * 60 * 60 * 12 });
      return json(200, { ok: true, token });
    }
    if (!verify(body.token)) return json(401, { error: "Session expired. Please log in again." });
    const gasUrl = process.env.APPS_SCRIPT_URL;
    const apiKey = process.env.APPS_SCRIPT_API_KEY;
    if (!gasUrl || !apiKey) return json(500, { error: "Netlify environment variables are incomplete." });
    const response = await fetch(gasUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: body.action, record: body.record || {}, apiKey })
    });
    const result = await response.json();
    if (!result.ok) return json(400, { error: result.error || "Google Sheets request failed." });
    return json(200, result);
  } catch (e) {
    return json(500, { error: e.message || "Unexpected server error." });
  }
};
