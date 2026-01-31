console.log("Loaded server.js from:", process.cwd());

import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config({ override: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Safe env debug (does NOT print the key itself)
const k = process.env.OPENAI_API_KEY || "";
console.log("OPENAI_API_KEY loaded:", k ? "YES" : "NO");
console.log("OPENAI_API_KEY prefix:", k.slice(0, 7));
console.log("OPENAI_API_KEY length:", k.length);

// ---- app init ----
const app = express();
app.use(express.json({ limit: "4mb" }));
app.use(express.static(__dirname));

// ---- password gate ----
const APP_PASSWORD = process.env.APP_PASSWORD;

function requirePassword(req, res, next) {
  if (!APP_PASSWORD) return next();

  const auth = req.headers.authorization;

  if (!auth || !auth.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Cloze Refiner"');
    return res.status(401).send("Password required");
  }

  const decoded = Buffer.from(auth.split(" ")[1], "base64").toString("utf8");
  const [, password] = decoded.split(":");

  if (password !== APP_PASSWORD) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Cloze Refiner"');
    return res.status(401).send("Wrong password");
  }

  next();
}

// Health check public
app.get("/health", (req, res) => res.status(200).send("ok"));

// Apply auth to everything else
app.use(requirePassword);

// Homepage
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "cap_cloze_refiner.html"));
});

const RULES = `
I am creating Anki cloze cards for pathology boards.

Follow these rules exactly unless I explicitly say otherwise.

FORMATTING
- Output must be clean, spaced, and easy to skim while editing in Anki.
- Use short lines and clear section headers.
- Do not change my wording unless needed for clarity.
- Final output must always be placed inside a single plain-text “copy window” (code-style box).
- Do not include explanations outside the copy window unless I ask.

CLOZE RULES
- Never use nested clozes.
- Cloze numbers must be sequential starting at c1 within each card.
- Cloze only 1 to 3 words per cloze, NO MORE THAN THAT.
- If something needs more than 3 words, split into multiple clozes.
- Use only as many clozes as necessary (do not over-cloze).
- Reusing the same cloze number multiple times on a card is allowed when concepts are tightly linked.
- If I specify a maximum number of clozes, obey it strictly.
- If I say “no clozes,” do not add any clozes.
- If content is a short phrase, keep it on the same line.
- Prefer clozing single anchors (1–2 words) like medically relevant clinical terms or disease or disease processes
- Do NOT cloze whole sentences.

IF INPUT ALREADY HAS CLOZES
- If the user input already contains clozes ({{c...::}}), you MUST NOT add any new clozes.
- Only edit existing cloze contents to comply with the rules.
- Preserve all existing cloze blocks (do not delete them).
- If an existing cloze block is too long, shorten the clozed text to a 1–3 word anchor (e.g., "hypnozoite", "Schuffner's dots", "48 hours") while keeping the surrounding sentence intact.



CLOZE NUMBERING (HARD RULE)
- Within EACH card, cloze numbers MUST start at c1 and be sequential with NO gaps (c1, c2, c3, ...).
- If the input already contains clozes with higher numbers (e.g., c5, c6, c8), you MUST renumber that card so clozes become c1..cN in the order they appear.
- Reusing the same cloze number multiple times is allowed, but the set of numbers used must still be sequential with no gaps.
- Example: if a card uses c5, c6, c8, c9 -> renumber to c1, c2, c3, c4 (preserve order of first appearance).


CONTENT RULES
- Cloze only high-yield anchors:
  diagnosis, mechanism, hallmark histology, key lab or molecular finding.
- Leave descriptive lists unclozed unless I explicitly ask.
- Prefer ↑ / ↓ arrows for lab changes.
- Keep content pathology-accurate and board-oriented.
- Do not invent grading systems, criteria, or facts.
- Do not over-explain.

WORKFLOW
- I will paste raw notes, partially clozed cards, or images.
- Your job is to clean, standardize, and fix them without violating any rules.
- If I paste an image, generate ONE high-yield study card tied to the image, using the same copy-window format.

IMPORTANT
- Do NOT add extra clozes.
- Do NOT merge unrelated concepts.
- Do NOT explain unless asked.
`.trim();

function pickAnchorWords(content, maxWords = 3) {
  const s = String(content || "").trim();

  // Prefer classic high-yield anchors
  const patterns = [
    /\bhypnozoite\b/i,
    /\bSchuffner'?s\b/i,
    /\bdots?\b/i,
    /\bmerozoites?\b/i,
    /\bschizonts?\b/i,
    /\btertian\b/i,
    /\bquotidian\b/i,
    /\b48\b/i,
    /\b24\b/i,
    /\bvivax\b/i,
    /\bovale\b/i,
    /\bmalariae\b/i,
    /\bknowlesi\b/i,
  ];

  // If content contains one of these words, return that word (+ optional companion word)
  for (const re of patterns) {
    const m = s.match(re);
    if (m) {
      const w = m[0];
      // Try to keep "Schuffner's dots" together if present
      if (/Schuffner/i.test(w) && /dots?/i.test(s)) return "Schuffner's dots";
      return w;
    }
  }

  // Otherwise: take first maxWords "word tokens" (strip punctuation edges)
  const words = s
    .split(/\s+/)
    .map(w => w.replace(/^[^\w]+|[^\w]+$/g, "")) // trim punctuation
    .filter(Boolean);

  if (!words.length) return s;
  return words.slice(0, maxWords).join(" ");
}

function enforceClozeWordLimit(text, maxWords = 3) {
  if (!text) return text;

  return text.replace(/\{\{c(\d+)::([\s\S]*?)\}\}/g, (full, n, inner) => {
    const content = String(inner).trim();
    const words = content.split(/\s+/).filter(Boolean);

    if (words.length <= maxWords) return full;

    // Salvage: replace long cloze content with a short anchor (1–3 words)
    const anchor = pickAnchorWords(content, maxWords);
    return `{{c${n}::${anchor}}}`;
  });
}


function renumberClozesPerCard(text, delimiter = "===CARD===") {
  const d = String(delimiter || "===CARD===");
  const cards = String(text || "").split(d);

  const fixed = cards.map((cardText) => {
    const map = new Map();
    let next = 1;

    // Match {{cN:: with optional spaces anywhere
    return cardText.replace(/\{\{\s*c(\d+)\s*::/g, (_m, oldNum) => {
      if (!map.has(oldNum)) map.set(oldNum, String(next++));
      return `{{c${map.get(oldNum)}::`;
    });
  });

  return fixed.join(d);
}



function capClozesToInput(outText, inText, delimiter = "===CARD===") {
  const d = String(delimiter || "===CARD===");
  const outCards = String(outText || "").split(d);
  const inCards = String(inText || "").split(d);

  const fixedCards = outCards.map((outCard, i) => {
    const inCard = inCards[i] ?? "";

    // Set of cloze numbers that already exist in THIS input card
    const allowed = new Set(
      Array.from(inCard.matchAll(/\{\{\s*c(\d+)\s*::/g)).map(m => String(m[1]))
    );

    // If input card has clozes, forbid any new cloze numbers not in the set
    if (allowed.size > 0) {
      return outCard.replace(/\{\{\s*c(\d+)\s*::([\s\S]*?)\}\}/g, (full, n, inner) => {
        return allowed.has(String(n)) ? full : String(inner).trim();
      });
    }

    // If input card had no clozes, allow normal behavior
    return outCard;
  });

  return fixedCards.join(d);
}


async function callOpenAI({ apiKey, model, temperature, input }) {
  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input,
      temperature: Number(temperature) || 0.2,
    }),
  });

  const raw = await r.text();
  if (!r.ok) throw new Error(`OpenAI error ${r.status}: ${raw}`);

  const data = JSON.parse(raw);
  return (
    data.output_text ??
    data.output?.[0]?.content?.map((c) => c.text).join("") ??
    ""
  );
}

// --------- REFINE (CLOZE) ---------
app.post("/api/refine", async (req, res) => {
  try {
    const apiKey = (process.env.OPENAI_API_KEY || "").trim();
    if (!apiKey) return res.status(500).send("Missing OPENAI_API_KEY environment variable.");

    const { 
  text, 
  model = "gpt-4.1-mini", 
  temperature = 0.2, 
  delimiter = "===CARD===",
  extraRules = ""
} = req.body || {};

    if (!text || typeof text !== "string") return res.status(400).send("Missing 'text'.");

    const d = String(delimiter || "===CARD===");

    const input = `
${RULES}

USER EXTRA RULES (optional):
${extraRules}

BATCH MODE INSTRUCTIONS
- The user input may contain multiple cards separated by the delimiter: ${d}
- Treat each chunk between delimiters as a separate card.
- Return the refined cards in the SAME ORDER.
- Output MUST use the SAME delimiter (${d}) between cards.
- Do not add extra cards. Do not remove cards.
- Do not add any extra commentary outside the copy windows.

USER INPUT:
${text}
`.trim();

    const out = await callOpenAI({ apiKey, model, temperature, input });

let fixed = out;

// 1) If input already had clozes, prevent adding NEW cloze numbers
fixed = capClozesToInput(fixed, text, d);

// 2) Enforce 1–3 words (your current version)
fixed = enforceClozeWordLimit(fixed, 3);

// 3) Renumber sequentially within each card
fixed = renumberClozesPerCard(fixed, d);

res.json({ text: fixed });



  } catch (e) {
    res.status(500).send(String(e?.message || e));
  }
});

// --------- REWRITE (EMAIL/MICRO/PATH) ---------
app.post("/api/rewrite", async (req, res) => {
  try {
    const apiKey = (process.env.OPENAI_API_KEY || "").trim();
    if (!apiKey) return res.status(500).send("Missing OPENAI_API_KEY");

    const {
      text,
      model = "gpt-4.1-mini",
      temperature = 0.2,
      preset = "email",
      rules = ""
    } = req.body || {};

    if (!text || typeof text !== "string") return res.status(400).send("Missing text");

    const BASE = `
Rewrite the text to be professional, concise, and clear.

Hard rules:
- Keep meaning identical
- Do not add facts
- Fix grammar and flow
- Remove filler
- Keep qualifiers (e.g., focal, patchy, cannot exclude)
- Output ONLY rewritten text (no bullets unless the input used bullets)
`.trim();

    const PRESETS = {
      email: `
Professional email tone.
Short paragraphs.
Polite but direct.
End with clear ask if present.
`.trim(),

      micro: `
Pathology microscopic description style.
Objective wording.
Keep positives/negatives.
Remove redundancy.
No new interpretation.
`.trim(),

      path: `
Professional pathology description/comment.
Concise.
Maintain structure.
Keep uncertainty qualifiers.
`.trim()
    };

    const input = `
${BASE}

STYLE:
${PRESETS[preset] || PRESETS.email}

USER RULES (optional):
${rules}

TEXT:
${text}
`.trim();

    const out = await callOpenAI({ apiKey, model, temperature, input });

    // IMPORTANT: do NOT run cloze limiter here
    res.json({ text: out });
  } catch (e) {
    res.status(500).send(String(e?.message || e));
  }
});

// ---- LISTEN ----
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
