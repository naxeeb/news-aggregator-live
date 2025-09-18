// public/app.js
const API = "/api/aggregate";
let data = [];
let filtered = [];
let selectedSources = new Set();
let interestOptions = new Set();

const cardsEl = document.getElementById("cards");
const countEl = document.getElementById("count");
const refreshBtn = document.getElementById("refreshBtn");
const sourcesEl = document.getElementById("sources");
const interestFilter = document.getElementById("interestFilter");
const searchInput = document.getElementById("search");
const emptyEl = document.getElementById("empty");

async function loadData() {
  countEl.textContent = "Loading…";
  try {
    const res = await fetch(API);
    const json = await res.json();
    data = Array.isArray(json) ? json : [];
    buildFilters();
    applyFilters();
    countEl.textContent = `${filtered.length} stories`;
  } catch (e) {
    console.error(e);
    countEl.textContent = "Failed to load";
  }
}

function buildFilters() {
  // sources
  const sources = Array.from(new Set(data.map(d => d.sourceLabel))).sort();
  sourcesEl.innerHTML = "";
  selectedSources = new Set(sources); // default allow all
  sources.forEach(s => {
    const btn = document.createElement("button");
    btn.textContent = s;
    btn.className = "src-toggle";
    btn.dataset.source = s;
    btn.onclick = () => {
      if (selectedSources.has(s)) {
        selectedSources.delete(s);
        btn.style.opacity = 0.5;
      } else {
        selectedSources.add(s);
        btn.style.opacity = 1;
      }
      applyFilters();
    };
    sourcesEl.appendChild(btn);
  });

  // interests
  interestOptions = new Set(["All", ...Array.from(new Set(data.map(d => d.interest || "General")))]);
  interestFilter.innerHTML = "";
  interestOptions.forEach(i => {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = i;
    interestFilter.appendChild(opt);
  });
}

function applyFilters() {
  const interest = interestFilter.value || "All";
  const q = (searchInput.value || "").trim().toLowerCase();

  filtered = data.filter(item => {
    if (selectedSources.size && !selectedSources.has(item.sourceLabel)) return false;
    if (interest !== "All" && (item.interest || "General") !== interest) return false;
    if (q) {
      const hay = (item.title + " " + (item.summary || "") + " " + (item.sourceLabel || "")).toLowerCase();
      return hay.includes(q);
    }
    return true;
  });

  renderCards();
  countEl.textContent = `${filtered.length} stories`;
}

function renderCards() {
  cardsEl.innerHTML = "";
  if (!filtered.length) {
    emptyEl.style.display = "block";
    return;
  }
  emptyEl.style.display = "none";

  filtered.forEach(item => {
    const card = document.createElement("article");
    card.className = "card";

    const metaRow = document.createElement("div");
    metaRow.className = "meta-row";
    const source = document.createElement("span");
    source.textContent = item.sourceLabel;
    const time = document.createElement("span");
    time.textContent = item.pubDate ? new Date(item.pubDate).toLocaleString() : "";
    const interest = document.createElement("span");
    interest.textContent = item.interest || "General";
    metaRow.appendChild(source);
    metaRow.appendChild(document.createTextNode("•"));
    metaRow.appendChild(time);
    metaRow.appendChild(document.createTextNode("•"));
    metaRow.appendChild(interest);

    const title = document.createElement("h3");
    const a = document.createElement("a");
    a.href = item.link;
    a.target = "_blank";
    a.rel = "noreferrer";
    a.textContent = item.title;
    title.appendChild(a);

    const summary = document.createElement("p");
    const max = 300;
    if (item.summary && item.summary.length > max) {
      summary.textContent = item.summary.slice(0, max) + "…";
      const btn = document.createElement("button");
      btn.className = "small-btn";
      btn.textContent = "Read more";
      btn.onclick = () => {
        if (btn.textContent === "Read more") {
          summary.textContent = item.summary;
          btn.textContent = "Show less";
        } else {
          summary.textContent = item.summary.slice(0, max) + "…";
          btn.textContent = "Read more";
        }
      };
      card.appendChild(metaRow);
      card.appendChild(title);
      card.appendChild(summary);
      card.appendChild(btn);
    } else {
      summary.textContent = item.summary || "";
      card.appendChild(metaRow);
      card.appendChild(title);
      if (item.summary) card.appendChild(summary);
    }

    // if an image is present, show it above summary (optional)
    if (item.image) {
      const img = document.createElement("img");
      img.src = item.image;
      img.alt = item.title;
      img.style.width = "100%";
      img.style.maxHeight = "180px";
      img.style.objectFit = "cover";
      img.style.borderRadius = "8px";
      img.style.marginTop = "8px";
      // place image after title and before summary
      card.insertBefore(img, card.children[2] || null);
    }

    // open source link
    const sourceBtn = document.createElement("a");
    sourceBtn.className = "small-btn";
    sourceBtn.textContent = "Open source ↗";
    sourceBtn.href = item.link;
    sourceBtn.target = "_blank";
    sourceBtn.rel = "noreferrer";
    sourceBtn.style.marginTop = "8px";
    card.appendChild(sourceBtn);

    cardsEl.appendChild(card);
  });
}

refreshBtn.onclick = () => {
  // clear cache server-side simply by hitting endpoint with param? For now re-fetch
  loadData();
};

interestFilter.onchange = applyFilters;
searchInput.oninput = applyFilters;

// initial
loadData();
