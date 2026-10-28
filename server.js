// Next Chapter - book recommendation server.
// The Mistral API key stays on the server and is read from MISTRAL_API_KEY.
const express = require("express");
const path = require("path");
const fs = require("fs");

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

const API_KEY = process.env.MISTRAL_API_KEY;
const MODEL = process.env.MISTRAL_MODEL || "mistral-small-latest";
const PORT = process.env.PORT || 3000;

if (!API_KEY) {
  console.warn("WARNING: MISTRAL_API_KEY is not set. /api/recommend will return an error.");
}

const app = express();
app.use(express.json({ limit: "50kb" }));
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

function buildPrompt(p) {
  const read = Array.isArray(p.booksRead)
    ? p.booksRead.slice(0, 40).map((b) => ({ title: clip(b.title, 150), rating: Number(b.rating) || null })).filter((b) => b.title)
    : [];
  const lines = [];
  if (read.length) {
    lines.push("Books the reader has read:");
    read.forEach((b) => lines.push(`- ${b.title}${b.rating ? ` (rated ${b.rating}/5)` : ""}`));
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
  return { text: lines.join("\n"), count, readTitles: read.map((b) => b.title) };
}

app.post("/api/recommend", async (req, res) => {
  if (!API_KEY) return res.status(500).json({ error: "The server has no MISTRAL_API_KEY set." });
  if (rateLimited(req.ip)) return res.status(429).json({ error: "Too many requests. Try again in a few minutes." });

  const { text, count, readTitles } = buildPrompt(req.body || {});
  if (!text.trim()) return res.status(400).json({ error: "Add at least one book, genre, or preference first." });

  const system =
    "You are a well-read librarian giving book recommendations. Recommend ONLY real, published books you are confident exist, " +
    "with the correct author. Never recommend a book the reader already listed. Respect genres and content they want to avoid. " +
    "Weight books they rated highly and learn from low ratings. Respond with JSON only, in this exact shape: " +
    '{"recommendations":[{"title":"","author":"","year":"","genre":"","why":"2-3 sentences tied to this reader\'s specific answers","similar_to":"a book they listed, or empty","content_notes":"brief heads-up or empty"}]}';

  try {
    const r = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.7,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: `${text}\n\nGive me exactly ${count} recommendations.` },
        ],
      }),
    });
    if (!r.ok) {
      const detail = await r.text();
      console.error("Mistral error", r.status, detail);
      return res.status(502).json({ error: `Mistral API returned ${r.status}. Check your API key and model name.` });
    }
    const data = await r.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}");
    const seen = new Set(readTitles.map((t) => t.toLowerCase()));
    const recs = (parsed.recommendations || []).filter((b) => b.title && !seen.has(String(b.title).toLowerCase()));
    res.json({ recommendations: recs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong getting recommendations. Try again." });
  }
});

app.listen(PORT, () => console.log(`Next Chapter running on http://localhost:${PORT}`));
