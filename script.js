/* ==========================================================================
   0→Shipped · Resume Parser (mock)
   Flow: pick a PDF → PDF.js extracts the text right here in the browser →
   we check that text against a skill checklist → render score + chips.
   No backend: nothing ever leaves the browser.
   ========================================================================== */

// ---- Checklist ------------------------------------------------------------
// Edit this list to score against a different role.
// `aliases` are alternate spellings that should also count as a match.
const SKILLS = [
  { name: "JavaScript", aliases: ["js"] },
  { name: "TypeScript", aliases: ["ts"] },
  { name: "Python" },
  { name: "React" },
  { name: "Next.js", aliases: ["nextjs"] },
  { name: "Node.js", aliases: ["nodejs", "node"] },
  { name: "HTML" },
  { name: "CSS" },
  { name: "SQL" },
  { name: "PostgreSQL", aliases: ["postgres"] },
  { name: "MongoDB", aliases: ["mongo"] },
  { name: "Redis" },
  { name: "REST API", aliases: ["rest", "restful"] },
  { name: "GraphQL" },
  { name: "Docker" },
  { name: "Kubernetes", aliases: ["k8s"] },
  { name: "AWS", aliases: ["amazon web services"] },
  { name: "Git" },
  { name: "CI/CD", aliases: ["cicd", "continuous integration"] },
  { name: "Jest" },
];

// Precompile one regex per skill. Boundaries keep "JavaScript" from
// matching inside unrelated words like "Bosch" (bosch... javascript? ok bad
// example — think "typography" matching "TS"). ([^a-z0-9] on both sides.)
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const SKILL_MATCHERS = SKILLS.map((skill) => {
  const variants = [skill.name, ...(skill.aliases || [])].map(escapeRegExp);
  return {
    name: skill.name,
    regex: new RegExp(`(?:^|[^a-z0-9])(?:${variants.join("|")})(?:[^a-z0-9]|$)`, "i"),
  };
});

// ---- DOM handles ----------------------------------------------------------
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const sampleBtn = document.getElementById("sampleBtn");
const statusEl = document.getElementById("status");
const uploadSection = document.getElementById("uploadSection");
const resultsEl = document.getElementById("results");
const gaugeFg = document.getElementById("gaugeFg");
const scoreNum = document.getElementById("scoreNum");
const verdictEl = document.getElementById("verdict");
const statPages = document.getElementById("statPages");
const statWords = document.getElementById("statWords");
const statMatched = document.getElementById("statMatched");
const presentCount = document.getElementById("presentCount");
const missingCount = document.getElementById("missingCount");
const presentChips = document.getElementById("presentChips");
const missingChips = document.getElementById("missingChips");
const resetBtn = document.getElementById("resetBtn");

const GAUGE_CIRCUMFERENCE = 2 * Math.PI * 52;

// ---- PDF text extraction (all client-side) --------------------------------
async function extractTextFromPdf(file) {
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;

  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((item) => item.str).join(" ") + "\n";
  }
  return { text, pages: pdf.numPages };
}

// ---- Scoring --------------------------------------------------------------
// Score = share of the checklist the resume mentions.
function analyze(text) {
  const present = [];
  const missing = [];

  for (const skill of SKILL_MATCHERS) {
    if (skill.regex.test(text)) present.push(skill.name);
    else missing.push(skill.name);
  }

  return {
    score: Math.round((present.length / SKILLS.length) * 100),
    present,
    missing,
    words: text.trim().split(/\s+/).length,
  };
}

// ---- Rendering ------------------------------------------------------------
function setStatus(message, { error = false, loading = false } = {}) {
  statusEl.hidden = false;
  statusEl.classList.toggle("error", error);
  statusEl.innerHTML = loading
    ? `<span class="spinner"></span>${message}`
    : message;
}

function clearStatus() {
  statusEl.hidden = true;
  statusEl.innerHTML = "";
}

function animateScore(target) {
  const duration = 900;
  const start = performance.now();
  const tick = (now) => {
    const progress = Math.min(1, (now - start) / duration);
    // ease-out cubic so the number settles rather than slamming to a stop
    const eased = 1 - Math.pow(1 - progress, 3);
    scoreNum.textContent = Math.round(target * eased);
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function verdictFor(score) {
  if (score >= 80) return { text: "Strong match — ready to ship 🚀", cls: "strong" };
  if (score >= 60) return { text: "Good match — a few gaps to close", cls: "good" };
  if (score >= 40) return { text: "Needs work — key skills missing", cls: "mid" };
  return { text: "Weak match — big gaps to fill", cls: "low" };
}

function render(result, pages) {
  gaugeFg.style.strokeDashoffset =
    GAUGE_CIRCUMFERENCE * (1 - result.score / 100);
  animateScore(result.score);

  const verdict = verdictFor(result.score);
  verdictEl.textContent = verdict.text;
  verdictEl.className = `verdict ${verdict.cls}`;

  statPages.textContent = pages;
  statWords.textContent = result.words.toLocaleString();
  statMatched.textContent = `${result.present.length}/${SKILLS.length}`;

  presentCount.textContent = `(${result.present.length})`;
  missingCount.textContent = `(${result.missing.length})`;
  presentChips.innerHTML = result.present
    .map((name) => `<span class="chip chip-good">${name}</span>`)
    .join("");
  missingChips.innerHTML = result.missing
    .map((name) => `<span class="chip chip-miss">${name}</span>`)
    .join("");

  uploadSection.hidden = true;
  resultsEl.hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function reset() {
  resultsEl.hidden = true;
  uploadSection.hidden = false;
  fileInput.value = "";
  clearStatus();
  // rewind the gauge so the next score animates from 0 again
  gaugeFg.style.transition = "none";
  gaugeFg.style.strokeDashoffset = GAUGE_CIRCUMFERENCE;
  scoreNum.textContent = "0";
  // force a reflow, then restore the transition
  void gaugeFg.getBoundingClientRect();
  gaugeFg.style.transition = "";
}

// ---- File handling --------------------------------------------------------
async function handleFile(file) {
  if (!file) return;

  const isPdf =
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) {
    setStatus("That's not a PDF — please upload a .pdf file.", { error: true });
    return;
  }

  if (typeof pdfjsLib === "undefined") {
    setStatus("Couldn't load PDF.js (offline?). Check your connection and reload.", {
      error: true,
    });
    return;
  }

  setStatus("Parsing resume…", { loading: true });
  dropzone.style.pointerEvents = "none";

  try {
    const { text, pages } = await extractTextFromPdf(file);
    if (!text.trim()) {
      setStatus(
        "Couldn't read any text from this PDF — it may be a scanned image. Try a text-based resume.",
        { error: true }
      );
      return;
    }
    render(analyze(text), pages);
  } catch (err) {
    console.error(err);
    setStatus("Something went wrong reading that PDF. Try another file.", {
      error: true,
    });
  } finally {
    dropzone.style.pointerEvents = "";
    fileInput.value = "";
    if (!resultsEl.hidden) clearStatus();
  }
}

// ---- Sample resume (so the demo works without a file) ---------------------
const SAMPLE_RESUME = `
NIVI P
Full-Stack Developer · Bengaluru, India
nivi@example.com · github.com/nivip

SUMMARY
Full-stack developer with 3 years of experience shipping web products end to end.
Comfortable across the stack: React on the frontend, Node.js on the backend, and
PostgreSQL underneath it all.

SKILLS
Languages: JavaScript, TypeScript, Python, SQL
Frontend: React, Next.js, HTML, CSS, Tailwind CSS
Backend: Node.js, Express, REST APIs, GraphQL
Databases: PostgreSQL, MongoDB, Redis
Tooling: Git, Docker, Linux, Jest, CI/CD with GitHub Actions, Figma, Agile

EXPERIENCE
Software Engineer — Acme Systems (2022 - present)
- Built and maintained REST APIs in Node.js handling ~50k requests a day.
- Migrated the marketing site to Next.js, cutting page load from 4.2s to 1.3s.
- Added Jest test suites and wired them into CI/CD so every PR is checked.
- Worked in an Agile team of 6 on two-week sprints.

Junior Developer — Bright Labs (2021 - 2022)
- Shipped a dashboard in React with a reusable component library.
- Wrote SQL migrations and tuned slow PostgreSQL queries.

EDUCATION
B.E. Computer Science, XYZ University, 2021
`;

// ---- Events ---------------------------------------------------------------
dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});

fileInput.addEventListener("change", () => handleFile(fileInput.files[0]));

dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("dz-active");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dz-active"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("dz-active");
  handleFile(e.dataTransfer.files[0]);
});

// stop the browser from navigating away if a file is dropped outside the zone
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

sampleBtn.addEventListener("click", () => render(analyze(SAMPLE_RESUME), 1));
resetBtn.addEventListener("click", reset);
