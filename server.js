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

async function callOpenAIChat({ apiKey, model, temperature, system, user }) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature,
      messages: [
        { role: "system", content: String(system || "").trim() },
        { role: "user", content: String(user || "").trim() },
      ],
    }),
  });

  const text = await r.text();
  if (!r.ok) throw new Error(text);

  const j = JSON.parse(text);
  return (j.choices?.[0]?.message?.content || "").trim();
}

function splitByDelimiter(raw, delimiter = "===CARD===") {
  const d = String(delimiter || "===CARD===");
  return String(raw || "")
    .split(d)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

function joinByDelimiter(parts, delimiter = "===CARD===") {
  const d = String(delimiter || "===CARD===");
  return parts.join(`\n${d}\n`);
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

    const rawText = String(text || "").trim();
    if (!rawText) return res.status(400).send("Missing 'text'.");

    const d = String(delimiter || "===CARD===");
    const extra = String(extraRules || "").trim();

    let input = "";

    // =======================
    // OVERRIDE MODE
    // =======================
    if (extra) {
      input = `
You are editing Anki cloze cards.

ABSOLUTE OVERRIDE MODE:
- Ignore ANY default/base rules.
- Follow ONLY the user's Extra Cloze Rules below.
- You MUST comply with them.
- If the user requests a specific number of clozes, you MUST produce exactly that many clozes PER CARD.
- Do NOT invent facts.
- Keep the original text content; only add/adjust cloze wrappers.

Batch rules:
- Input may contain multiple cards separated by delimiter: ${d}
- Return same number of cards, same order
- Output MUST use the SAME delimiter (${d}) between cards
- Output ONLY the cards (no commentary)

USER EXTRA RULES:
${extra}

USER INPUT:
${rawText}
`.trim();
    } else {
      // =======================
      // NORMAL STRICT MODE
      // =======================
      input = `
${RULES}

BATCH MODE INSTRUCTIONS
- The user input may contain multiple cards separated by the delimiter: ${d}
- Treat each chunk between delimiters as a separate card.
- Return the refined cards in the SAME ORDER.
- Output MUST use the SAME delimiter (${d}) between cards.
- Do not add extra cards. Do not remove cards.
- Do not add any extra commentary outside the copy windows.

USER INPUT:
${rawText}
`.trim();
    }

    // ✅ Call OpenAI ONCE
    const out = await callOpenAI({ apiKey, model, temperature, input });

    let finalOut = out || "";

    // ✅ If Extra Rules is present: return RAW model output, no server enforcement
    if (extra) {
      return res.json({ text: out });
    }

    // ✅ Normal strict enforcement
    let fixed = out;
    fixed = capClozesToInput(fixed, rawText, d);
    fixed = enforceClozeWordLimit(fixed, 3);
    fixed = renumberClozesPerCard(fixed, d);

    return res.json({ text: fixed });
  } catch (e) {
    return res.status(500).send(String(e?.message || e));
  }
});

// --------- REWRITE (GENERAL/EMAIL/MICRO/PATH) ---------
app.post("/api/rewrite", async (req, res) => {
  try {
    const apiKey = (process.env.OPENAI_API_KEY || "").trim();
    if (!apiKey) return res.status(500).send("Missing OPENAI_API_KEY");

    const {
      text,
      model = "gpt-4.1-mini",
      temperature = 0.2,
      preset = "general",
      rules = "",
      delimiter = "" // optional; empty means "single block"
    } = req.body || {};

    if (!text || typeof text !== "string") return res.status(400).send("Missing text");

    const userRules = String(rules || "").trim();
    const d = String(delimiter || "").trim();

    // If delimiter provided, treat as multi-chunk; else single text block
    const chunks = d ? splitByDelimiter(text, d) : [text.trim()];
    if (!chunks[0]) return res.status(400).send("Empty text after trimming.");

    // =======================
    // DEFAULTS
    // =======================
  //this does nothing currently (rewrite base_section)
    const BASE_REWRITE = `
Rewrite the text to be professional, concise, and clear.

Hard rules:
- Keep meaning identical
- Do not add facts
- Fix grammar and flow
- Remove filler
- Keep qualifiers (e.g., focal, patchy, cannot exclude)
- Output ONLY rewritten text (no bullets unless the input used bullets)
`.trim();
//// this does nothing currently

    const PRESETS = {
general: `
You are a helpful assistant.

CRITICAL OUTPUT RULES:
- If the input is a question, output ONLY the final answer.
- Do NOT ask follow-up questions.
- No preface, no commentary.

If the input is pasted content/notes (not a question):
- Summarize the key points succinctly.
- Be personable, yet professional
`.trim(),

      email: `
Professional email tone.
Polite but direct.
`.trim(),

      micro: `
Make a better microscopic description used for a pathology report. 
Sound like an experienced pathologist describing what they see at sign-out.
No emdashes. 
`.trim(),

      gross: `
Rewrite a pathology gross description to be clear and concise.

RULES:
- Keep all measurements, laterality, specimen parts, and identifiers exactly correct
- Do not invent findings
- Prefer standard surgical pathology gross style
- Use complete sentences
- Keep orientation/ink/margins information explicit
- Avoid em dashes and bullets
`.trim(),

      path: `
Rewrite the pathology text to improve clarity, precision, and diagnostic usefulness.

STYLE & SCOPE:
- Maintain the original bullet structure and diagnostic flow
- Wording MAY be improved, but stay close to the original phrasing
- Prefer pathology-standard terminology
- Avoid unnecessary synonym substitution

RULES:
- Do not embellish or editorialize
- Do not over-smooth or make prose-like
- Keep statements direct and diagnostic
- Prefer tightening and reordering over complete rephrasing
- No colons or semicolons
- Bullet-style diagnostic structure preferred

The output should sound like a senior pathologist lightly refining the original text.
`.trim()
    };

// =======================
// ALL PRESETS = CHATGPT-STYLE OUTPUT
// (Keeps your PRESETS so you can refine later.)
// =======================
const p = String(preset || "general").toLowerCase();
const presetSystem = PRESETS[p] || PRESETS.general;

// Rules box overrides preset instructions (optional)
const system = userRules
  ? `You are a helpful assistant.

ABSOLUTE OVERRIDE MODE:
- Follow ONLY the user's rules below. They override all other instructions.
- Output ONLY the response (no preface, no commentary, no quotes).

USER RULES:
${userRules}`.trim()
  : presetSystem;

// User content
const user = chunks.join("\n\n");

// Normal ChatGPT-style response for ALL presets
let finalOut = await callOpenAIChat({
  apiKey,
  model,
  temperature: Number(temperature) || 0.2,
  system,
  user,
});

finalOut = String(finalOut || "").trim();

// If it re-asks the question, force a second pass (optional guard)
if (finalOut.endsWith("?")) {
  finalOut = await callOpenAIChat({
    apiKey,
    model,
    temperature: 0,
    system: "Return ONLY the final answer. Do NOT restate or rephrase the question.",
    user,
  });
  finalOut = String(finalOut || "").trim();
}


  // Single block mode
  if (!d) return res.json({ text: finalOut });

  // Delimiter mode (must split finalOut)
  const outChunks = splitByDelimiter(finalOut, d);

  if (outChunks.length !== chunks.length) {
    console.log("general chunk mismatch", {
      inChunks: chunks.length,
      outChunks: outChunks.length,
      delimiter: d,
    });
    return res.json({
      text: finalOut,
      warning: `Model returned ${outChunks.length} chunk(s) but expected ${chunks.length}.`,
    });
  }

const fixed = joinByDelimiter(outChunks, d);
return res.json({ text: fixed });

  } catch (e) {
    res.status(500).send(String(e?.message || e));
  }
});

// ---- LISTEN ----
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
