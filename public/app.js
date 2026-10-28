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
    notes: fd.get("notes")
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
