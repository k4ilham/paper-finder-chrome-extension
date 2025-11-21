const q = document.getElementById("query")
const minYear = document.getElementById("minYear")
const maxYear = document.getElementById("maxYear")
const minCitations = document.getElementById("minCitations")
const maxResults = document.getElementById("maxResults")
const statusEl = document.getElementById("status")
const resultsEl = document.getElementById("results")
const btn = document.getElementById("searchBtn")
const exportBtn = document.getElementById("exportBtn")
const STATE_KEY = "pf_state_v1"
let lastResults = []

function yearNow() {
  const d = new Date()
  return d.getFullYear()
}

function toYear(item) {
  const p = item.issued && item.issued["date-parts"]
  if (Array.isArray(p) && p.length > 0 && Array.isArray(p[0]) && p[0].length > 0) return p[0][0]
  return undefined
}

function toAuthors(item) {
  const list = Array.isArray(item.author) ? item.author : []
  return list.map(a => {
    const given = a.given ? a.given : ""
    const family = a.family ? a.family : ""
    return [given, family].filter(Boolean).join(" ")
  }).join(", ")
}

function toJournal(item) {
  const ct = item["container-title"]
  if (Array.isArray(ct) && ct.length > 0) return ct[0]
  if (typeof ct === "string") return ct
  return ""
}

function buildUrl() {
  const query = encodeURIComponent(q.value.trim())
  const rows = parseInt(maxResults.value || "50", 10)
  const filters = []
  const minY = parseInt(minYear.value || "", 10)
  const maxY = parseInt(maxYear.value || "", 10)
  if (!isNaN(minY)) filters.push(`from-pub-date:${minY}-01-01`)
  if (!isNaN(maxY)) filters.push(`until-pub-date:${maxY}-12-31`)
  const filterStr = filters.join(",")
  const params = [
    `query=${query}`,
    `rows=${isNaN(rows) ? 50 : Math.min(Math.max(rows, 1), 100)}`,
    `select=title,author,issued,container-title,DOI,URL,is-referenced-by-count`,
    `sort=score`,
    `order=desc`
  ]
  if (filterStr) params.push(`filter=${encodeURIComponent(filterStr)}`)
  return `https://api.crossref.org/works?${params.join("&")}`
}

function storageGet(key) {
  return new Promise(resolve => {
    try {
      chrome.storage.local.get(key, r => resolve(r[key]))
    } catch (_) {
      resolve(undefined)
    }
  })
}

function storageSet(obj) {
  return new Promise(resolve => {
    try {
      chrome.storage.local.set(obj, resolve)
    } catch (_) {
      resolve()
    }
  })
}

function collectState() {
  return {
    query: q.value.trim(),
    minYear: minYear.value,
    maxYear: maxYear.value,
    minCitations: minCitations.value,
    maxResults: maxResults.value
  }
}

async function saveState() {
  const state = collectState()
  await storageSet({ [STATE_KEY]: { state, results: lastResults, ts: Date.now() } })
}

async function search() {
  const queryText = q.value.trim()
  if (!queryText) return
  btn.disabled = true
  statusEl.textContent = "Mencari..."
  resultsEl.innerHTML = ""
  try {
    const url = buildUrl()
    const res = await fetch(url)
    if (!res.ok) throw new Error("Gagal mengambil data")
    const data = await res.json()
    const items = Array.isArray(data.message.items) ? data.message.items : []
    const minC = parseInt(minCitations.value || "0", 10)
    const filtered = items.filter(it => {
      const c = it["is-referenced-by-count"]
      return typeof c === "number" ? c >= minC : minC === 0
    })
    lastResults = filtered
    await saveState()
    render(filtered)
    statusEl.textContent = `Menampilkan ${filtered.length} hasil`
  } catch (e) {
    statusEl.textContent = "Terjadi kesalahan"
  } finally {
    btn.disabled = false
  }
}

function render(items) {
  if (!items.length) {
    resultsEl.innerHTML = `<div class="empty">Tidak ada hasil</div>`
    return
  }
  const html = items.map((it, idx) => {
    const title = Array.isArray(it.title) && it.title.length ? it.title[0] : (typeof it.title === "string" ? it.title : "Tanpa judul")
    const authors = toAuthors(it)
    const y = toYear(it)
    const j = toJournal(it)
    const doi = it.DOI ? `https://doi.org/${it.DOI}` : ""
    const url = it.URL || doi
    const c = typeof it["is-referenced-by-count"] === "number" ? it["is-referenced-by-count"] : 0
    return `
      <div class="item">
        <div class="num">${idx + 1}</div>
        <div>
          <h3>${title}</h3>
          <div class="meta">${authors}${authors ? " • " : ""}${y ? y : ""}${j ? " • " + j : ""} • Sitasi: ${c}</div>
        </div>
        <div class="actions">
          ${doi ? `<a class="link doi" href="${doi}" target="_blank">DOI</a>` : ""}
          ${url ? `<a class="link open" href="${url}" target="_blank">Buka</a>` : ""}
        </div>
      </div>
    `
  }).join("")
  resultsEl.innerHTML = html
}

async function initDefaults() {
  if (!maxYear.value) maxYear.value = String(yearNow())
  const saved = await storageGet(STATE_KEY)
  if (saved && saved.state) {
    const s = saved.state
    q.value = s.query || ""
    minYear.value = s.minYear || ""
    maxYear.value = s.maxYear || String(yearNow())
    minCitations.value = s.minCitations || "0"
    maxResults.value = s.maxResults || "50"
    lastResults = Array.isArray(saved.results) ? saved.results : []
    if (lastResults.length) {
      resultsEl.innerHTML = ""
      render(lastResults)
      statusEl.textContent = `Riwayat: ${lastResults.length} hasil`
    }
  }
}

btn.addEventListener("click", search)
document.addEventListener("keydown", e => {
  if (e.key === "Enter") search()
})
;[q, minYear, maxYear, minCitations, maxResults].forEach(el => {
  el.addEventListener("change", () => { saveState() })
})
initDefaults()

function escapeCSV(v) {
  const s = v == null ? "" : String(v)
  return '"' + s.replace(/"/g, '""') + '"'
}

function toCSV(items) {
  const header = ["No", "Title", "Authors", "Year", "Journal", "Citations", "DOI", "URL"]
  const rows = items.map((it, idx) => {
    const title = Array.isArray(it.title) && it.title.length ? it.title[0] : (typeof it.title === "string" ? it.title : "")
    const authors = toAuthors(it)
    const y = toYear(it) || ""
    const j = toJournal(it) || ""
    const c = typeof it["is-referenced-by-count"] === "number" ? it["is-referenced-by-count"] : ""
    const doi = it.DOI ? `https://doi.org/${it.DOI}` : ""
    const url = it.URL || doi || ""
    return [idx + 1, title, authors, y, j, c, doi, url].map(escapeCSV).join(",")
  })
  return header.map(escapeCSV).join(",") + "\n" + rows.join("\n")
}

function downloadCSV(name, data) {
  const blob = new Blob([data], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, 0)
}

function exportCSV() {
  const items = lastResults || []
  if (!items.length) return
  const csv = toCSV(items)
  const base = (q.value || "paper_finder").trim().replace(/\s+/g, "_").slice(0, 40)
  const name = `${base || "paper_finder"}_results.csv`
  downloadCSV(name, csv)
}

if (exportBtn) exportBtn.addEventListener("click", exportCSV)