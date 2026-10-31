const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const path = require("path");
const { Pool } = require("pg");

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const DEV_MODE = process.env.DEV_MODE === "true";
const SANDBOX = process.env.PAYFAST_SANDBOX !== "false";
const PF = {
  id: process.env.PAYFAST_MERCHANT_ID || (SANDBOX ? "10000100" : ""),
  key: process.env.PAYFAST_MERCHANT_KEY || (SANDBOX ? "46f0cd694581a" : ""),
  pass: process.env.PAYFAST_PASSPHRASE || "",
  host: SANDBOX ? "sandbox.payfast.co.za" : "www.payfast.co.za",
};
const PRICE = "50.00";

// ---------- Supabase / PostgreSQL ----------
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is not set. See README for how to get it from Supabase."); process.exit(1); }
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const q = async (sql, p = []) => (await pool.query(sql, p)).rows;
const COLS = `s.id, s.owner_id AS "ownerId", s.name, s.url, s.logo, s.approved, s.hidden, s.paid_until AS "paidUntil"`;
const storeOf = async (ownerId) => (await q(`SELECT ${COLS} FROM stores s WHERE s.owner_id = $1`, [ownerId]))[0];
const id = () => crypto.randomBytes(8).toString("hex");
let SECRET = process.env.TOKEN_SECRET;

// ---------- helpers ----------
const hash = (pw, salt = crypto.randomBytes(16).toString("hex")) => salt + ":" + crypto.scryptSync(pw, salt, 32).toString("hex");
const verify = (pw, stored) => {
  const [salt, h] = stored.split(":");
  return crypto.timingSafeEqual(Buffer.from(hash(pw, salt).split(":")[1], "hex"), Buffer.from(h, "hex"));
};
const sign = (uid) => {
  const p = Buffer.from(JSON.stringify({ uid, exp: Date.now() + 30 * 864e5 })).toString("base64url");
  return p + "." + crypto.createHmac("sha256", SECRET).update(p).digest("base64url");
};
const tries = {};
const blocked = (k) => (tries[k] = (tries[k] || []).filter((t) => Date.now() - t < 9e5)).length >= 10;
const isLive = (s) => s.approved && !s.hidden && s.paidUntil && new Date(s.paidUntil) >= new Date();
const nextMonth = (paidUntil) => {
  const d = paidUntil && new Date(paidUntil) > new Date() ? new Date(paidUntil) : new Date();
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
};
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((e) => { console.error(e); res.status(500).json({ error: "Server error" }); });

const auth = wrap(async (req, res, next) => {
  try {
    const [p, s] = (req.get("authorization") || "").replace("Bearer ", "").split(".");
    if (crypto.createHmac("sha256", SECRET).update(p).digest("base64url") !== s) throw 0;
    const d = JSON.parse(Buffer.from(p, "base64url"));
    if (d.exp < Date.now()) throw 0;
    req.user = (await q("SELECT id, email, name, role FROM users WHERE id = $1", [d.uid]))[0];
    if (!req.user) throw 0;
  } catch (e) { return res.status(401).json({ error: "Please log in again" }); }
  next();
});
const admin = (req, res, next) => (req.user.role === "admin" ? next() : res.status(403).json({ error: "Admins only" }));

// ---------- setup tables, secret and first admin ----------
async function init() {
  await q(`CREATE TABLE IF NOT EXISTS users (id text PRIMARY KEY, email text UNIQUE NOT NULL, name text, pw text NOT NULL, role text NOT NULL DEFAULT 'owner')`);
  await q(`CREATE TABLE IF NOT EXISTS stores (id text PRIMARY KEY, owner_id text NOT NULL, name text NOT NULL, url text NOT NULL, logo text, approved boolean NOT NULL DEFAULT false, hidden boolean NOT NULL DEFAULT false, paid_until text)`);
  await q(`CREATE TABLE IF NOT EXISTS kv (key text PRIMARY KEY, value text NOT NULL)`);
  // lock the tables so nobody can read them through Supabase's public API; this server connects directly
  for (const t of ["users", "stores", "kv"]) { try { await q(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`); } catch (e) {} }
  if (!SECRET) {
    let r = (await q("SELECT value FROM kv WHERE key = 'secret'"))[0];
    if (!r) { r = { value: crypto.randomBytes(32).toString("hex") }; await q("INSERT INTO kv (key, value) VALUES ('secret', $1)", [r.value]); }
    SECRET = r.value;
  }
  const email = (process.env.ADMIN_EMAIL || "").toLowerCase();
  if (email && process.env.ADMIN_PASSWORD) {
    const u = (await q("SELECT id FROM users WHERE email = $1", [email]))[0];
    if (u) await q("UPDATE users SET role = 'admin', pw = $1 WHERE id = $2", [hash(process.env.ADMIN_PASSWORD), u.id]);
    else await q("INSERT INTO users (id, email, name, pw, role) VALUES ($1, $2, 'Admin', $3, 'admin')", [id(), email, hash(process.env.ADMIN_PASSWORD)]);
  } else if (!(await q("SELECT id FROM users WHERE role = 'admin'")).length) {
    const pw = crypto.randomBytes(6).toString("hex");
    await q("INSERT INTO users (id, email, name, pw, role) VALUES ($1, 'admin@marketrentalplace.local', 'Admin', $2, 'admin')", [id(), hash(pw)]);
    console.log(`\n*** First admin created. Email: admin@marketrentalplace.local  Password: ${pw}  (set ADMIN_EMAIL and ADMIN_PASSWORD to choose your own) ***\n`);
  }
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));

// ---------- public: what the phone app calls ----------
app.get("/stores", wrap(async (req, res) => {
  const all = await q(`SELECT ${COLS} FROM stores s ORDER BY s.name`);
  res.json(all.filter(isLive).map(({ id, name, url, logo }) => ({ id, name, url, logo })));
}));

// ---------- accounts ----------
app.post("/api/register", wrap(async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || password.length < 6) return res.status(400).json({ error: "Email and a password of 6+ characters required" });
  const e = email.toLowerCase().trim();
  if ((await q("SELECT id FROM users WHERE email = $1", [e])).length) return res.status(409).json({ error: "Email already registered" });
  const uid = id();
  await q("INSERT INTO users (id, email, name, pw, role) VALUES ($1, $2, $3, $4, 'owner')", [uid, e, name || "", hash(password)]);
  res.json({ token: sign(uid), role: "owner" });
}));
app.post("/api/login", wrap(async (req, res) => {
  const email = (req.body.email || "").toLowerCase().trim(), k = req.ip + email;
  if (blocked(k)) return res.status(429).json({ error: "Too many attempts. Try again in 15 minutes." });
  const u = (await q("SELECT id, pw, role FROM users WHERE email = $1", [email]))[0];
  if (!u || !verify(req.body.password || "", u.pw)) { tries[k].push(Date.now()); return res.status(401).json({ error: "Wrong email or password" }); }
  res.json({ token: sign(u.id), role: u.role });
}));
app.get("/api/me", auth, wrap(async (req, res) => {
  const store = (await storeOf(req.user.id)) || null;
  res.json({ email: req.user.email, role: req.user.role, store, live: store ? !!isLive(store) : false, devMode: DEV_MODE });
}));
app.post("/api/store", auth, wrap(async (req, res) => {
  const { name, url, logo } = req.body;
  if (!name || !/^https?:\/\//i.test(url || "")) return res.status(400).json({ error: "Name and a link starting with https:// required" });
  const old = await storeOf(req.user.id);
  if (!old) await q("INSERT INTO stores (id, owner_id, name, url, logo) VALUES ($1, $2, $3, $4, $5)", [id(), req.user.id, name.trim(), url.trim(), (logo || "").trim()]);
  else await q("UPDATE stores SET name = $1, url = $2, logo = $3, approved = $4 WHERE id = $5",
    [name.trim(), url.trim(), (logo || "").trim(), old.url === url.trim() ? old.approved : false, old.id]); // a new link needs re-approval
  res.json(await storeOf(req.user.id));
}));

// ---------- PayFast ----------
const enc = (v) => encodeURIComponent(String(v).trim()).replace(/%20/g, "+").replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
const signature = (pairs) => {
  let s = pairs.filter(([, v]) => v !== "" && v != null).map(([k, v]) => `${k}=${enc(v)}`).join("&");
  if (PF.pass) s += `&passphrase=${enc(PF.pass)}`;
  return crypto.createHash("md5").update(s).digest("hex");
};
app.post("/api/pay", auth, wrap(async (req, res) => {
  const s = await storeOf(req.user.id);
  if (!s) return res.status(400).json({ error: "Add your store first" });
  if (!PF.id) return res.status(500).json({ error: "PayFast is not configured" });
  const fields = [
    ["merchant_id", PF.id], ["merchant_key", PF.key],
    ["return_url", `${BASE_URL}/?paid=1`], ["cancel_url", `${BASE_URL}/?paid=0`],
    ...(BASE_URL.startsWith("https://") ? [["notify_url", `${BASE_URL}/api/itn`]] : []),
    ["name_first", (req.user.name || "Store owner").slice(0, 100)], ["email_address", req.user.email],
    ["m_payment_id", s.id], ["amount", PRICE], ["item_name", "Market Rental Place monthly listing"],
    ["subscription_type", "1"], ["recurring_amount", PRICE], ["frequency", "3"], ["cycles", "0"],
  ];
  fields.push(["signature", signature(fields)]);
  res.json({ action: `https://${PF.host}/eng/process`, fields });
}));
app.post("/api/itn", async (req, res) => {
  res.sendStatus(200);
  try {
    const pairs = Object.entries(req.body).filter(([k]) => k !== "signature");
    if (signature(pairs) !== req.body.signature) return console.log("ITN: bad signature");
    const v = await fetch(`https://${PF.host}/eng/query/validate`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: pairs.map(([k, val]) => `${k}=${enc(val)}`).join("&"),
    });
    if ((await v.text()).trim() !== "VALID") return console.log("ITN: not valid");
    const s = (await q(`SELECT ${COLS} FROM stores s WHERE s.id = $1`, [req.body.m_payment_id]))[0];
    if (!s || req.body.payment_status !== "COMPLETE" || Number(req.body.amount_gross) < Number(PRICE)) return;
    await q("UPDATE stores SET paid_until = $1 WHERE id = $2", [nextMonth(s.paidUntil), s.id]);
    console.log("ITN: paid", s.name);
  } catch (e) { console.log("ITN error", e.message); }
});
app.post("/api/dev/simulate-payment", auth, wrap(async (req, res) => {
  if (!DEV_MODE) return res.sendStatus(404);
  const s = await storeOf(req.user.id);
  if (!s) return res.sendStatus(400);
  await q("UPDATE stores SET paid_until = $1 WHERE id = $2", [nextMonth(s.paidUntil), s.id]);
  res.json(await storeOf(req.user.id));
}));

// ---------- admin ----------
app.get("/api/admin/stores", auth, admin, wrap(async (req, res) => {
  const rows = await q(`SELECT ${COLS}, u.email AS owner FROM stores s LEFT JOIN users u ON u.id = s.owner_id ORDER BY s.name`);
  res.json(rows.map((s) => ({ ...s, live: !!isLive(s) })));
}));
app.post("/api/admin/stores/:id/:action", auth, admin, wrap(async (req, res) => {
  const sid = req.params.id, a = req.params.action;
  const s = (await q(`SELECT ${COLS} FROM stores s WHERE s.id = $1`, [sid]))[0];
  if (!s) return res.sendStatus(404);
  if (a === "approve") await q("UPDATE stores SET approved = true, hidden = false WHERE id = $1", [sid]);
  else if (a === "hide") await q("UPDATE stores SET hidden = true WHERE id = $1", [sid]);
  else if (a === "unhide") await q("UPDATE stores SET hidden = false WHERE id = $1", [sid]);
  else if (a === "activate") await q("UPDATE stores SET approved = true, hidden = false, paid_until = $1 WHERE id = $2", [nextMonth(s.paidUntil), sid]);
  else if (a === "delete") await q("DELETE FROM stores WHERE id = $1", [sid]);
  else return res.sendStatus(400);
  res.json({ ok: true });
}));

init()
  .then(() => app.listen(PORT, () => console.log(`Market Rental Place backend on ${BASE_URL}  (database connected, PayFast ${SANDBOX ? "SANDBOX" : "LIVE"})`)))
  .catch((e) => { console.error("Could not connect to the database:", e.message); process.exit(1); });
