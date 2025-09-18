// index.js
const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const NodeCache = require("node-cache");
const path = require("path");
const cors = require("cors");

const PORT = process.env.PORT || 3000;
const cache = new NodeCache({ stdTTL: 300 }); // 5 minutes cache

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const SITES = [
  { name: "tbsnews.net", base: "https://www.tbsnews.net" },
  { name: "thedailystar.net", base: "https://www.thedailystar.net" },
  { name: "aljazeera.com", base: "https://www.aljazeera.com" },
  { name: "adweek.com", base: "https://www.adweek.com" }
];

function normalizeUrl(href, base) {
  try {
    if (!href) return null;
    href = href.trim();
    if (href.startsWith("//")) href = "https:" + href;
    if (href.startsWith("http")) return href;
    return new URL(href, base).href;
  } catch (e) {
    return null;
  }
}

async function fetchHtml(url) {
  try {
    const res = await axios.get(url, {
      headers: {
        "User-Agent": "news-aggregator/1.0 (+https://example.com)"
      },
      timeout: 15000
    });
    return res.data;
  } catch (e) {
    console.warn("fetchHtml failed:", url, e.message);
    return null;
  }
}

function safeText($el) {
  if (!$el || !$el.text) return "";
  return $el.text().replace(/\s+/g, " ").trim();
}

async function extractArticleMeta(url) {
  const html = await fetchHtml(url);
  if (!html) return null;
  const $ = cheerio.load(html);

  // Try OG tags first
  const ogTitle = $('meta[property="og:title"]').attr("content");
  const ogDesc = $('meta[property="og:description"]').attr("content");
  const ogImage = $('meta[property="og:image"]').attr("content");
  const articleTime = $('meta[property="article:published_time"]').attr("content") || $('time').attr('datetime') || $('time').text();

  // fallback
  const title = ogTitle || $('title').first().text() || safeText($("h1").first());
  const description = ogDesc || $('meta[name="description"]').attr("content") || safeText($("p").first());

  // try first inline image if no OG image
  let image = ogImage;
  if (!image) {
    const firstImg = $("img").filter(function () {
      const src = $(this).attr("src") || $(this).attr("data-src");
      return src && !src.includes("sprite") && !src.includes("logo");
    }).first();
    image = firstImg.attr("src") || firstImg.attr("data-src") || null;
    if (image && image.startsWith("//")) image = "https:" + image;
    if (image && image.startsWith("/")) {
      // relative
      try { image = new URL(image, url).href; } catch (e) {}
    }
  }

  return {
    title: title ? title.trim() : null,
    summary: description ? description.trim() : "",
    image: image || null,
    pubDate: articleTime || null,
    link: url
  };
}

async function discoverLinksForSite(baseUrl, domain, limit = 6) {
  const html = await fetchHtml(baseUrl);
  if (!html) return [];
  const $ = cheerio.load(html);
  const seen = new Set();
  const links = [];

  $('a[href]').each((i, el) => {
    let href = $(el).attr("href");
    href = normalizeUrl(href, baseUrl);
    if (!href) return;
    // ignore anchors, mailto, javascript
    if (href.startsWith("mailto:") || href.includes("javascript:") || href.includes("#")) return;
    // only same domain
    try {
      const h = new URL(href);
      if (!h.hostname.includes(domain)) return;
    } catch (e) {
      return;
    }
    // ignore static assets
    if (/\.(jpg|jpeg|png|gif|svg|pdf|zip|mp4)(\?.*)?$/i.test(href)) return;
    if (!seen.has(href)) {
      seen.add(href);
      links.push(href);
    }
  });

  return links.slice(0, limit);
}

async function aggregateSite(site) {
  try {
    const links = await discoverLinksForSite(site.base, site.name, 8);
    const pagePromises = links.map(async (l) => {
      const meta = await extractArticleMeta(l);
      if (!meta || !meta.title) return null;
      return {
        id: `${site.name}-${Buffer.from(l).toString("base64").slice(0, 12)}`,
        title: meta.title,
        link: l,
        pubDate: meta.pubDate || new Date().toISOString(),
        summary: meta.summary || "",
        image: meta.image || null,
        sourceLabel: site.name,
        interest: detectInterest(meta.title + " " + (meta.summary || ""), site.name)
      };
    });

    const settled = await Promise.allSettled(pagePromises);
    const items = settled
      .filter(r => r.status === "fulfilled" && r.value)
      .map(r => r.value);
    return items;
  } catch (e) {
    console.warn("aggregateSite failed for", site.name, e.message);
    return [];
  }
}

function detectInterest(text, source) {
  // Very simple keyword-based classification (tweakable)
  const t = (text || "").toLowerCase();
  if (t.match(/\bbangladesh\b|\bdhaka\b|\brajshahi\b/)) return "Bangladesh";
  if (t.match(/\belection\b|\bminister\b|\bparliament\b|\bpolitic\b/)) return "Politics";
  if (t.match(/\beconomy\b|\binflation\b|\bgdp\b|\bexport\b|\bimport\b|\bbank\b|remittance|tariff/)) return "Economy";
  if (t.match(/\bbrand\b|\badvertis/i)) return "Business/Branding";
  if (t.match(/\bsport|asia cup|cricket|football|match/)) return "Sports";
  if (t.match(/\btech|software|ai|app\b/)) return "Technology";
  if (source.includes("aljazeera")) return "International";
  return "General";
}

app.get("/api/aggregate", async (req, res) => {
  const cached = cache.get("agg");
  if (cached) return res.json(cached);

  try {
    // Run all site aggregation in parallel
    const jobs = SITES.map(site => aggregateSite(site));
    const results = await Promise.allSettled(jobs);

    const all = results
      .filter(r => r.status === "fulfilled")
      .flatMap(r => r.value)
      .map(item => {
        // normalize date
        const pubTs = item.pubDate ? new Date(item.pubDate).getTime() : Date.now();
        return { ...item, pubTs };
      })
      .sort((a, b) => b.pubTs - a.pubTs)
      .slice(0, 80); // cap

    cache.set("agg", all, 300);
    res.json(all);
  } catch (e) {
    console.error("aggregate error", e);
    res.status(500).json({ error: "failed to aggregate" });
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
