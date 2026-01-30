console.log("Loaded server.js from:", process.cwd());

import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- app init (must be before app.listen) ----
const app = express();
app.use(express.json({ limit: "4mb" }));
app.use(express.static(__dirname)); // serves cap_cloze_refiner.html, script.js, etc.

// ---- password gate (optional but recommended) ----
const APP_PASSWORD = process.env.APP_PASSWORD;

function requirePassword(req, res, next) {
  if (!APP_PASSWORD) return next(); // dev mode if unset

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

// Health check should be public for Render (optional)
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
- Use only as many clozes as necessary (do not over-cloze).
- Reusing the same cloze number multiple times on a card is allowed when concepts are tightly linked.
- If I specify a maximum number of clozes, obey it strictly.
- If I say “no clozes,” do not add any clozes.
- If content is a short phrase, keep it on the same line.

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

app.post("/api/refine", async (req, res) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).send("Missing OPENAI_API_KEY environment variable.");

    const { text, model = "gpt-4.1-mini", temperature = 0.2, delimiter = "===CARD===" } = req.body || {};
    if (!text || typeof text !== "string") return res.status(400).send("Missing 'text'.");

    const d = String(delimiter || "===CARD===");

    const input = `
${RULES}

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
    res.json({ text: out });
  } catch (e) {
    res.status(500).send(String(e?.message || e));
  }
});

// ---- LISTEN (must be at bottom, after app is defined) ----
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
