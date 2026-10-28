// Next Chapter - book recommendation server.
// The OpenRouter API key stays on the server and is read from OPENROUTER_API_KEY.
// Every page and API route sits behind a password gate (ACCESS_CODE).
const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

// Tiny .env loader for local use (no extra dependency). Real env vars win.
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !line.trim().startsWith("#") && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

const API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
const PORT = process.env.PORT || 3000;
const SITE_URL = process.env.PUBLIC_SITE_URL || `http://localhost:${PORT}`;
const ACCESS_CODE = process.env.ACCESS_CODE || "";

if (!API_KEY) {
  console.warn("WARNING: OPENROUTER_API_KEY is not set. /api/recommend will return an error.");
}
if (!ACCESS_CODE) {
  console.warn("WARNING: ACCESS_CODE is not set. The site is locked for everyone until it is.");
}

const app = express();
// Vercel terminates TLS in front of the function, so trust its forwarded headers
// for req.ip and req.secure.
app.set("trust proxy", 1);
app.use(express.json({ limit: "50kb" }));

// ---------------------------------------------------------------------------
// Password gate
//
// The session cookie is "<expiryMs>.<hmac>" where the HMAC is keyed from the
// ACCESS_CODE itself, so changing the code immediately invalidates every
// existing session and no extra secret has to be configured. The check runs
// before express.static, so no page, stylesheet, script or API route is served
// without a valid session.
// ---------------------------------------------------------------------------
const SESSION_COOKIE = "nc_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function sessionKey() {
  return crypto.createHash("sha256").update(`next-chapter:${ACCESS_CODE}`).digest();
}

function signSession(expiry) {
  return crypto.createHmac("sha256", sessionKey()).update(String(expiry)).digest("hex");
}

function makeSessionValue(expiry = Date.now() + SESSION_TTL_MS) {
  return `${expiry}.${signSession(expiry)}`;
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a), "utf8");
  const bufB = Buffer.from(String(b), "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function validSessionValue(token) {
  if (!token || typeof token !== "string") return false;
  const dot = token.indexOf(".");
  if (dot === -1) return false;
  const expiry = Number(token.slice(0, dot));
  if (!Number.isFinite(expiry) || expiry < Date.now()) return false;
  return safeEqual(token.slice(dot + 1), signSession(expiry));
}

function parseCookies(header) {
  const out = {};
  String(header || "").split(";").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (!k) return;
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
  });
  return out;
}

function isHttps(req) {
  return req.secure || req.headers["x-forwarded-proto"] === "https";
}

function sessionCookie(req, value, maxAgeSeconds) {
  const bits = [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (isHttps(req)) bits.push("Secure");
  return bits.join("; ");
}

// Pages that must be reachable to log in. Everything else is gated.
const PUBLIC_PATHS = new Set(["/login", "/login.html", "/api/login", "/style.css"]);

// Brute-force guard: 10 wrong codes per IP per 10 minutes.
const loginHits = new Map();
function loginRateLimited(ip) {
  const now = Date.now();
  const recent = (loginHits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  recent.push(now);
  loginHits.set(ip, recent);
  return recent.length > 10;
}

app.use((req, res, next) => {
  const p = req.path;

  if (p === "/favicon.ico") return res.status(204).end();
  if (PUBLIC_PATHS.has(p)) return next();

  // No ACCESS_CODE configured: fail closed rather than exposing the site.
  if (!ACCESS_CODE) {
    return res.status(503).type("text/plain").send(
      "This site is not configured yet: ACCESS_CODE is not set on the server."
    );
  }

  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (validSessionValue(token)) return next();

  if (p.startsWith("/api/")) {
    return res.status(401).json({ error: "Locked. Enter the access code." });
  }
  return res.redirect(302, "/login");
});

app.post("/api/login", (req, res) => {
  if (!ACCESS_CODE) {
    return res.status(503).json({ error: "This site is not configured yet: ACCESS_CODE is not set." });
  }
  if (loginRateLimited(req.ip)) {
    return res.status(429).json({ error: "Too many attempts. Try again in a few minutes." });
  }
  const code = String((req.body && req.body.code) || "");
  if (!code || !safeEqual(code, ACCESS_CODE)) {
    return res.status(401).json({ error: "That code is not right." });
  }
  res.setHeader("Set-Cookie", sessionCookie(req, makeSessionValue(), Math.floor(SESSION_TTL_MS / 1000)));
  res.json({ ok: true });
});

app.post("/api/logout", (req, res) => {
  res.setHeader("Set-Cookie", sessionCookie(req, "", 0));
  res.json({ ok: true });
});

app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.use(express.static(path.join(__dirname, "public")));

// Simple in-memory rate limit: 10 requests per IP per 10 minutes.
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 10;
}

const clip = (v, n = 500) => String(v ?? "").slice(0, n).trim();
const list = (v, n = 40) => (Array.isArray(v) ? v.slice(0, n).map((x) => clip(x, 120)).filter(Boolean) : []);

// Loose title key so "Queued Up" from the model matches "Queued Up by Doe, John"
// from an import, regardless of case, punctuation, subtitles or a leading article.
function normKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleKeys(entry) {
  const keys = new Set();
  const title = typeof entry === "string" ? entry : (entry && entry.title) || "";
  const author = typeof entry === "string" ? "" : (entry && entry.author) || "";
  const push = (v) => { const k = normKey(v); if (k) keys.add(k); };
  push(title);
  if (author) push(`${title} ${author}`);
  // Form rows arrive as "Title by Author".
  const m = String(title).match(/^(.*?)\s+by\s+(.+)$/i);
  if (m) {
    push(m[1]);
    if (m[2]) push(`${m[1]} ${m[2]}`);
  }
  return keys;
}

function displayLabel(entry) {
  if (typeof entry === "string") return entry;
  if (!entry || !entry.title) return "";
  return entry.author ? `${entry.title} by ${entry.author}` : entry.title;
}

function buildPrompt(p) {
  const read = Array.isArray(p.booksRead)
    ? p.booksRead.slice(0, 40).map((b) => ({ title: clip(b.title, 150), rating: Number(b.rating) || null })).filter((b) => b.title)
    : [];
  // Books already on the reader's shelf (e.g. imported from Goodreads) are
  // excluded from results so we never recommend something they already have.
  const clean = (arr, limit, n) => (Array.isArray(arr) ? arr.slice(0, limit).map((entry) => {
    if (typeof entry === "string") return clip(entry, n);
    if (!entry || !entry.title) return null;
    return { title: clip(entry.title, n), author: clip(entry.author, 80) };
  }).filter(Boolean) : []);
  const queued = clean(p.toRead, 200, 120);
  // Imported library titles that are not in the visible form: still excluded
  // from results, but kept out of the prompt to keep it small.
  const extraExcludes = clean(p.excludeTitles, 250, 100);
  const lines = [];
  if (read.length) {
    lines.push("Books the reader has read:");
    read.forEach((b) => lines.push(`- ${b.title}${b.rating ? ` (rated ${b.rating}/5)` : ""}`));
  }
  if (queued.length) {
    lines.push(`Already on their to-read shelf, do NOT recommend these: ${queued.slice(0, 60).map(displayLabel).join("; ")}`);
  }
  const add = (label, val) => { if (val && (!Array.isArray(val) || val.length)) lines.push(`${label}: ${Array.isArray(val) ? val.join(", ") : val}`); };
  add("Favorite genres", list(p.favGenres));
  add("Genres to avoid", list(p.avoidGenres));
  add("Favorite authors", clip(p.favAuthors));
  add("Fiction or nonfiction", clip(p.fictionPref, 40));
  add("Current mood", list(p.moods));
  add("Themes they enjoy", list(p.themes));
  add("Preferred tone", list(p.tones));
  add("Pacing", clip(p.pace, 40));
  add("Length", clip(p.length, 40));
  add("Setting or era", clip(p.setting));
  add("Audience / reading level", clip(p.audience, 60));
  add("Format", list(p.formats));
  add("Content to avoid", clip(p.contentAvoid));
  add("Adventurousness (1 = very similar to what they know, 5 = surprise me)", clip(p.adventure, 5));
  add("Anything else", clip(p.notes, 800));
  const count = Math.min(Math.max(parseInt(p.count, 10) || 5, 1), 10);
  const excludeKeys = new Set();
  for (const group of [read, queued, extraExcludes]) {
    for (const entry of group) for (const k of titleKeys(entry)) excludeKeys.add(k);
  }
  return { text: lines.join("\n"), count, excludeKeys };
}

const SYSTEM_PROMPT =
  "You are a well-read librarian giving book recommendations. Recommend ONLY real, published books you are confident exist, " +
  "with the correct author. Never recommend a book the reader already listed. Respect genres and content they want to avoid. " +
  "Weight books they rated highly and learn from low ratings. Respond with JSON only, in this exact shape: " +
  '{"recommendations":[{"title":"","author":"","year":"","genre":"","why":"2-3 sentences tied to this reader\'s specific answers","similar_to":"a book they listed, or empty","content_notes":"brief heads-up or empty"}]}';

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// OpenRouter needs the account's authorisation plus, optionally, attribution
// headers. The key itself never leaves this file.
function callOpenRouter(payload) {
  return fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
      "HTTP-Referer": SITE_URL,
      "X-Title": "Next Chapter",
    },
    body: JSON.stringify(payload),
  });
}

// Models differ in how cleanly they wrap JSON; strip code fences before parsing.
function parseModelJson(raw) {
  const text = String(raw || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try { return JSON.parse(text.slice(start, end + 1)); } catch { return {}; }
    }
    return {};
  }
}

app.post("/api/recommend", async (req, res) => {
  if (!API_KEY) return res.status(500).json({ error: "The server has no OPENROUTER_API_KEY set." });
  if (rateLimited(req.ip)) return res.status(429).json({ error: "Too many requests. Try again in a few minutes." });

  const { text, count, excludeKeys } = buildPrompt(req.body || {});
  if (!text.trim()) return res.status(400).json({ error: "Add at least one book, genre, or preference first." });

  const payload = {
    model: MODEL,
    temperature: 0.7,
    max_tokens: 2000,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `${text}\n\nGive me exactly ${count} recommendations.` },
    ],
  };

  try {
    let r = await callOpenRouter(payload);

    // Not every OpenRouter model accepts response_format. If the provider says
    // so, retry once without it rather than failing the whole request.
    if (!r.ok && [400, 404, 422].includes(r.status)) {
      const firstDetail = await r.text();
      if (/response_format|structured|json_object/i.test(firstDetail)) {
        const { response_format, ...withoutFormat } = payload;
        r = await callOpenRouter(withoutFormat);
        if (!r.ok) {
          const detail = await r.text();
          console.error("OpenRouter error", r.status, detail);
          return res.status(502).json({ error: `OpenRouter API returned ${r.status}. Check your API key and model name.` });
        }
      } else {
        console.error("OpenRouter error", r.status, firstDetail);
        return res.status(502).json({ error: `OpenRouter API returned ${r.status}. Check your API key and model name.` });
      }
    } else if (!r.ok) {
      const detail = await r.text();
      console.error("OpenRouter error", r.status, detail);
      return res.status(502).json({ error: `OpenRouter API returned ${r.status}. Check your API key and model name.` });
    }

    const data = await r.json();
    const parsed = parseModelJson(data.choices?.[0]?.message?.content);
    const recs = (parsed.recommendations || []).filter((b) => {
      if (!b.title) return false;
      for (const k of titleKeys({ title: b.title, author: b.author })) {
        if (excludeKeys.has(k)) return false;
      }
      return true;
    });
    if (!recs.length) {
      console.error("OpenRouter returned no usable recommendations:", JSON.stringify(data).slice(0, 500));
      return res.status(502).json({ error: "The model did not return usable recommendations. Try again or pick another model." });
    }
    res.json({ recommendations: recs, model: MODEL });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong getting recommendations. Try again." });
  }
});

// Vercel imports this file as a serverless function, so only listen when the
// file is run directly (`npm start`). Exporting the app lets Vercel use it.
if (require.main === module) {
  app.listen(PORT, () => console.log(`Next Chapter running on http://localhost:${PORT} (model: ${MODEL})`));
}

module.exports = app;
