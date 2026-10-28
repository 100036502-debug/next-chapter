const OPTIONS = {
  favGenres: ["Literary fiction", "Fantasy", "Science fiction", "Mystery", "Thriller", "Romance", "Historical fiction", "Horror", "Horror-comedy", "Dystopian", "Magical realism", "Contemporary", "Humor", "Graphic novels", "Poetry", "Memoir", "Biography", "History", "Science", "Self-improvement", "Philosophy", "True crime", "Business", "Travel"],
  avoidGenres: ["Romance", "Horror", "Fantasy", "Science fiction", "Thriller", "Historical fiction", "Self-improvement", "Poetry", "True crime", "Erotica", "War"],
  moods: ["Cozy", "Adventurous", "Reflective", "Escapist", "Dark", "Uplifting", "Intellectually challenging", "Need a good cry", "Want to laugh", "Nostalgic"],
  themes: ["Found family", "Coming of age", "Redemption", "Power and politics", "Friendship", "Identity", "Survival", "Love and loss", "Mystery and secrets", "Social justice", "Nature", "Technology and AI", "Mythology", "Family saga", "Underdog stories", "Moral dilemmas"],
  tones: ["Funny", "Heartwarming", "Gritty", "Lyrical", "Suspenseful", "Whimsical", "Melancholy", "Fast-witted", "Quiet and thoughtful"],
  formats: ["Print", "E-book", "Audiobook"]
};

// Build chip groups and radio groups
document.querySelectorAll(".chips").forEach((el) => {
  const group = el.dataset.group;
  OPTIONS[group].forEach((label) => {
    const l = document.createElement("label");
    l.innerHTML = `<input type="checkbox" name="${group}" value="${label}"><span>${label}</span>`;
    el.appendChild(l);
  });
});
document.querySelectorAll(".radios").forEach((el) => {
  const name = el.dataset.radio;
  el.dataset.options.split(",").forEach((label) => {
    const l = document.createElement("label");
    l.innerHTML = `<input type="radio" name="${name}" value="${label}"><span>${label}</span>`;
    el.appendChild(l);
  });
});

// Book rows
const booksEl = document.getElementById("books");
function addBookRow() {
  const row = document.createElement("div");
  row.className = "book-row";
  row.innerHTML = `
    <input type="text" class="b-title" placeholder="Title and author, e.g. Piranesi by Susanna Clarke" aria-label="Book title">
    <select class="b-rating" aria-label="Your rating">
      <option value="">Rating</option>
      <option value="5">5 - loved</option><option value="4">4</option><option value="3">3</option><option value="2">2</option><option value="1">1 - disliked</option>
    </select>
    <button type="button" aria-label="Remove this book">&times;</button>`;
  row.querySelector("button").onclick = () => { if (booksEl.children.length > 1) row.remove(); else row.querySelector(".b-title").value = ""; };
  booksEl.appendChild(row);
}
for (let i = 0; i < 3; i++) addBookRow();
document.getElementById("addBook").onclick = addBookRow;

// --- Goodreads CSV import ------------------------------------------------
// Importing only seeds the book rows. Every manual control (genres, mood,
// tone, pacing, and so on) is left exactly as the reader set it, and any book
// rows already typed by hand are kept.
const LIBRARY_KEY = "nc_library";   // books read, from the import
const TO_READ_KEY = "nc_to_read";   // shelf to keep out of the results
const IMPORT_ROW_LIMIT = 20;        // rows shown in the form
const EXCLUDE_LIMIT = 250;          // titles sent to the server as "never suggest"

function readStore(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function writeStore(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* storage blocked */ }
}

// Minimal RFC4180 parser: quoted fields, doubled quotes, CRLF and a BOM.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const src = String(text).replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field); field = "";
    } else if (ch === "\n") {
      row.push(field); rows.push(row); row = []; field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
}

function goodreadsRows(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => String(h).trim().toLowerCase());
  const at = (name) => header.indexOf(name);
  const iTitle = at("title");
  const iAuthor = at("author");
  const iRating = at("my rating");
  const iShelf = at("exclusive shelf");
  const iDate = at("date read");
  // "Title" and "Author" are Goodreads' own columns; without them this is not
  // a Goodreads export and we say so rather than guessing.
  if (iTitle === -1 || iAuthor === -1) return [];
  return rows.slice(1).map((r) => ({
    title: String(r[iTitle] || "").trim(),
    author: String(r[iAuthor] || "").trim(),
    rating: iRating >= 0 ? Number(r[iRating]) || 0 : 0,
    shelf: iShelf >= 0 ? String(r[iShelf] || "").trim().toLowerCase() : "",
    dateRead: iDate >= 0 ? String(r[iDate] || "").trim() : ""
  })).filter((b) => b.title);
}

function labelFor(b) {
  return b.author ? `${b.title} by ${b.author}` : b.title;
}

// Fills empty book rows first, then appends, never touching typed rows.
function fillBookRows(books) {
  const rowsNow = () => [...booksEl.querySelectorAll(".book-row")];
  const typed = new Set(
    rowsNow().map((r) => r.querySelector(".b-title").value.trim().toLowerCase()).filter(Boolean)
  );
  const ranked = [...books]
    .sort((a, b) => (b.rating - a.rating) || String(b.dateRead).localeCompare(String(a.dateRead)))
    .slice(0, IMPORT_ROW_LIMIT);

  const queue = [];
  for (const b of ranked) {
    const label = labelFor(b);
    if (typed.has(label.toLowerCase()) || typed.has(b.title.toLowerCase())) continue;
    queue.push({ label, rating: b.rating });
  }

  let filled = 0;
  for (const row of rowsNow()) {
    if (!queue.length) break;
    if (row.querySelector(".b-title").value.trim()) continue;
    const next = queue.shift();
    row.querySelector(".b-title").value = next.label;
    row.querySelector(".b-rating").value = next.rating ? String(next.rating) : "";
    filled++;
  }
  while (queue.length && rowsNow().length < IMPORT_ROW_LIMIT) {
    addBookRow();
    const row = rowsNow()[rowsNow().length - 1];
    const next = queue.shift();
    row.querySelector(".b-title").value = next.label;
    row.querySelector(".b-rating").value = next.rating ? String(next.rating) : "";
    filled++;
  }
  return filled;
}

function updateLibraryNote() {
  const el = document.getElementById("libraryNote");
  if (!el) return;
  const lib = readStore(LIBRARY_KEY).length;
  const queue = readStore(TO_READ_KEY).length;
  if (!lib && !queue) { el.textContent = ""; return; }
  el.innerHTML = `Saved library: ${lib} read, ${queue} to-read. Used in every search until cleared. <button type="button" class="linkbtn" id="clearLibrary">clear</button>`;
  el.querySelector("#clearLibrary").onclick = () => {
    writeStore(LIBRARY_KEY, []);
    writeStore(TO_READ_KEY, []);
    updateLibraryNote();
    document.getElementById("importStatus").textContent = "Library cleared. Your typed books are untouched.";
  };
}

const csvInput = document.getElementById("csvFile");
if (csvInput) {
  csvInput.addEventListener("change", async () => {
    const file = csvInput.files && csvInput.files[0];
    if (!file) return;
    const statusEl2 = document.getElementById("importStatus");
    statusEl2.className = "import-status";
    statusEl2.textContent = "Reading your library...";
    try {
      const text = await file.text();
      const all = goodreadsRows(text);
      if (!all.length) {
        throw new Error("That does not look like a Goodreads export. Use My Books, Import and Export, Export to CSV.");
      }
      const readBooks = all.filter((b) => b.shelf === "read" || (!b.shelf && b.rating));
      const queued = all.filter((b) => b.shelf === "to-read" || b.shelf === "currently-reading");

      writeStore(LIBRARY_KEY, readBooks);
      writeStore(TO_READ_KEY, queued.slice(0, EXCLUDE_LIMIT).map((b) => ({ title: b.title, author: b.author })));

      const filled = fillBookRows(readBooks);
      statusEl2.textContent =
        `Imported ${readBooks.length} read book${readBooks.length === 1 ? "" : "s"}` +
        (queued.length ? ` and ${queued.length} to-read` : "") +
        `. ${filled} loaded into the list below. Add genres, mood and the rest as usual.`;
      updateLibraryNote();
    } catch (err) {
      statusEl2.className = "import-status error";
      statusEl2.textContent = err.message;
    } finally {
      csvInput.value = "";
    }
  });
}

// Submit
const form = document.getElementById("form");
const statusEl = document.getElementById("status");
const listEl = document.getElementById("list");
const btn = document.getElementById("submit");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(form);
  const payload = {
    booksRead: [...booksEl.querySelectorAll(".book-row")].map((r) => ({
      title: r.querySelector(".b-title").value.trim(),
      rating: r.querySelector(".b-rating").value
    })).filter((b) => b.title),
    favGenres: fd.getAll("favGenres"),
    avoidGenres: fd.getAll("avoidGenres"),
    moods: fd.getAll("moods"),
    themes: fd.getAll("themes"),
    tones: fd.getAll("tones"),
    formats: fd.getAll("formats"),
    favAuthors: fd.get("favAuthors"),
    fictionPref: fd.get("fictionPref"),
    pace: fd.get("pace"),
    length: fd.get("length"),
    setting: fd.get("setting"),
    audience: fd.get("audience"),
    contentAvoid: fd.get("contentAvoid"),
    adventure: fd.get("adventure"),
    count: fd.get("count"),
    notes: fd.get("notes"),
    // Imported shelves do not replace anything above; they only add context.
    toRead: readStore(TO_READ_KEY).slice(0, 200),
    excludeTitles: readStore(LIBRARY_KEY).slice(0, EXCLUDE_LIMIT).map((b) => ({ title: b.title, author: b.author }))
  };

  // Books marked "Read it" in an earlier round count as books they've read,
  // so they're fed back in (and never recommended again).
  const typed = new Set(payload.booksRead.map((b) => b.title.trim().toLowerCase()));
  for (const saved of readLog()) {
    const title = saved.title.trim();
    if (!title || typed.has(title.toLowerCase())) continue;
    payload.booksRead.push({
      title: saved.author ? `${title} by ${saved.author}` : title,
      rating: String(saved.rating)
    });
  }

  btn.disabled = true;
  btn.textContent = "Searching the stacks...";
  statusEl.className = "status";
  statusEl.textContent = "Finding books for you...";
  listEl.innerHTML = "";

  try {
    const res = await fetch("/api/recommend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");
    if (!data.recommendations.length) {
      statusEl.textContent = "No new suggestions came back. Try adding more detail and search again.";
    } else {
      statusEl.textContent = `${data.recommendations.length} books picked for you. Double-check details before buying, since AI can occasionally get a book wrong.`;
      data.recommendations.forEach((b) => listEl.appendChild(renderBook(b)));
    }
  } catch (err) {
    statusEl.className = "status error";
    statusEl.textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "Find my next book";
  }
});

function esc(s) { const d = document.createElement("div"); d.textContent = s ?? ""; return d.innerHTML; }

function renderBook(b) {
  const li = document.createElement("li");
  li.className = "book";
  const q = encodeURIComponent(`${b.title} ${b.author}`);
  li.innerHTML = `
    <h2>${esc(b.title)}</h2>
    <div class="by">${esc(b.author)}${b.year ? ", " + esc(b.year) : ""}${b.genre ? " - " + esc(b.genre) : ""}</div>
    <p>${esc(b.why)}</p>
    ${b.similar_to ? `<p class="meta">If you liked ${esc(b.similar_to)}</p>` : ""}
    ${b.content_notes ? `<p class="note">${esc(b.content_notes)}</p>` : ""}
    <p><a href="https://openlibrary.org/search?q=${q}" target="_blank" rel="noopener">Look it up on Open Library</a></p>
    <div class="readbar"></div>`;
  const bar = li.querySelector(".readbar");
  bar._book = b;
  paintReadBar(bar, b);
  return li;
}

// --- reading log: books marked "Read it" plus the 1-5 rating -------------
const READ_LOG_KEY = "nc_read_log";

function readLog() {
  try {
    const raw = JSON.parse(localStorage.getItem(READ_LOG_KEY) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function saveLog(log) {
  try { localStorage.setItem(READ_LOG_KEY, JSON.stringify(log)); } catch { /* storage full or blocked */ }
}

function bookKey(b) {
  return `${String(b.title || "").trim().toLowerCase()}|${String(b.author || "").trim().toLowerCase()}`;
}

function ratingFor(b) {
  const hit = readLog().find((x) => x.key === bookKey(b));
  return hit ? Number(hit.rating) || 0 : 0;
}

function setRating(b, rating) {
  const log = readLog().filter((x) => x.key !== bookKey(b));
  if (rating) {
    log.push({ key: bookKey(b), title: b.title || "", author: b.author || "", rating, at: new Date().toISOString() });
  }
  saveLog(log);
  updateLogNote();
updateLibraryNote();
}

function stars(n) {
  return "\u2605".repeat(n) + "\u2606".repeat(Math.max(0, 5 - n));
}

function paintReadBar(bar, b) {
  const current = ratingFor(b);
  bar.innerHTML = "";
  if (!current) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ghost readbtn";
    btn.textContent = "Read it";
    btn.onclick = () => askRating(bar, b);
    bar.appendChild(btn);
    return;
  }
  const label = document.createElement("span");
  label.className = "readstate";
  label.textContent = `Read it \u00b7 you rated it ${stars(current)}`;
  bar.appendChild(label);
  const change = document.createElement("button");
  change.type = "button";
  change.className = "linkbtn";
  change.textContent = "change";
  change.onclick = () => askRating(bar, b);
  bar.appendChild(change);
}

function askRating(bar, b) {
  bar.innerHTML = "";
  const q = document.createElement("span");
  q.className = "readstate";
  q.textContent = "How did you like it?";
  bar.appendChild(q);
  for (let i = 1; i <= 5; i++) {
    const s = document.createElement("button");
    s.type = "button";
    s.className = "starbtn";
    s.textContent = String(i);
    s.title = `${i} out of 5`;
    s.setAttribute("aria-label", `Rate it ${i} out of 5`);
    s.onclick = () => { setRating(b, i); paintReadBar(bar, b); };
    bar.appendChild(s);
  }
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "linkbtn";
  cancel.textContent = "cancel";
  cancel.onclick = () => paintReadBar(bar, b);
  bar.appendChild(cancel);
}

function updateLogNote() {
  const el = document.getElementById("logNote");
  if (!el) return;
  const log = readLog();
  if (!log.length) {
    el.textContent = "";
    return;
  }
  el.innerHTML = `${log.length} book${log.length === 1 ? "" : "s"} in your reading log, used to sharpen the next round. <button type="button" class="linkbtn" id="clearLog">clear</button>`;
  el.querySelector("#clearLog").onclick = () => {
    saveLog([]);
    updateLogNote();
    document.querySelectorAll(".readbar").forEach((bar) => { if (bar._book) paintReadBar(bar, bar._book); });
  };
}

updateLogNote();
