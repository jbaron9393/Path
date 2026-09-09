// Single home for all OpenAI HTTP calls.
//
// The old server.js had four almost-identical fetch wrappers:
//   callOpenAI              -> /v1/responses, plain "input" string
//   callOpenAIWithWebSearch -> /v1/responses, system+user, web_search tool
//   callOpenAIMultimodal    -> /v1/responses, system+user, image input
//   callOpenAIChat          -> /v1/chat/completions, system+user
//
// The first three all hit the same endpoint and differed only in how the
// request body was shaped, so they're merged into callOpenAIResponses below.
// callOpenAIChat stays separate because it's a genuinely different endpoint
// (used for the default /api/rewrite path, with no responses-API features).

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

function extractResponseOutputText(data) {
  const direct = String(data?.output_text || "").trim();
  if (direct) return direct;

  const outputs = Array.isArray(data?.output) ? data.output : [];
  const texts = [];
  for (const item of outputs) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const c of content) {
      const t = typeof c?.text === "string" ? c.text : "";
      if (t.trim()) texts.push(t);
    }
  }
  return texts.join("\n").trim();
}

/**
 * Calls the OpenAI Responses API (/v1/responses).
 *
 * Two input shapes are supported, matching the original three call sites:
 *
 *  - Plain prompt mode: pass `input` (a raw string). Used by the cloze
 *    refine/export pipeline, which builds one big prompt string itself.
 *      callOpenAIResponses({ apiKey, model, temperature, input })
 *
 *  - Message mode: pass `system` + `user` (and optionally `images` and/or
 *    `useWebSearch`). Used by /api/rewrite.
 *      callOpenAIResponses({ apiKey, model, temperature, system, user })
 *      callOpenAIResponses({ apiKey, model, temperature, system, user, useWebSearch: true })
 *      callOpenAIResponses({ apiKey, model, temperature, system, user, images: [dataUrl, ...] })
 */
export async function callOpenAIResponses({
  apiKey,
  model,
  temperature = 0.2,
  input,
  system,
  user,
  images = [],
  useWebSearch = false,
}) {
  const body = { model, temperature: Number(temperature) || 0.2 };
  const plainPromptMode = input != null;

  if (plainPromptMode) {
    // Plain prompt mode — identical to the old callOpenAI().
    body.input = input;
  } else if (images.length) {
    // Multimodal message mode — identical to the old callOpenAIMultimodal().
    const userContent = [];
    if (String(user || "").trim()) {
      userContent.push({ type: "input_text", text: String(user).trim() });
    }
    for (const dataUrl of images) {
      userContent.push({ type: "input_image", image_url: dataUrl });
    }
    body.input = [
      { role: "system", content: [{ type: "input_text", text: String(system || "").trim() }] },
      { role: "user", content: userContent },
    ];
  } else {
    // Plain text message mode — identical to the old callOpenAIWithWebSearch().
    body.input = [
      { role: "system", content: String(system || "").trim() },
      { role: "user", content: String(user || "").trim() },
    ];
    if (useWebSearch) body.tools = [{ type: "web_search" }];
  }

  const r = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const raw = await r.text();
  if (!r.ok) throw new Error(`OpenAI responses error ${r.status}: ${raw}`);

  const data = JSON.parse(raw);

  // Preserve each original function's exact extraction behavior:
  if (plainPromptMode) {
    // Matches the old callOpenAI(): only ever looks at output[0].
    return data.output_text ?? data.output?.[0]?.content?.map((c) => c.text).join("") ?? "";
  }
  // Matches the old callOpenAIWithWebSearch()/callOpenAIMultimodal(): walks
  // every output item, needed for tool-using / multimodal responses that can
  // return more than one output block.
  return extractResponseOutputText(data);
}

export async function callOpenAIChat({ apiKey, model, temperature, system, user }) {
  const r = await fetch(OPENAI_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
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
