document.addEventListener("DOMContentLoaded", () => {
  const bulkInput = document.getElementById("bulkInput");
  const outputs = document.getElementById("outputs");
  const emptyState = document.getElementById("emptyState");

  const statusEl = document.getElementById("status");
  const inputStats = document.getElementById("inputStats");

  const modelEl = document.getElementById("model");
  const tempEl = document.getElementById("temp");
  const autoInsertBtn = document.getElementById("autoInsert");

  const refineAllBtn = document.getElementById("refineAll");
  const clearBtn = document.getElementById("clear");
  const copyAllBtn = document.getElementById("copyAll");
  const downloadAllBtn = document.getElementById("downloadAll");

  const extraRulesEl = document.getElementById("extraRules"); // optional box

  // ---- hard fails (prevents "nothing happens") ----
  const required = [
    ["bulkInput", bulkInput],
    ["outputs", outputs],
    ["status", statusEl],
    ["inputStats", inputStats],
    ["model", modelEl],
    ["temp", tempEl],
    ["autoInsert", autoInsertBtn],
    ["refineAll", refineAllBtn],
    ["clear", clearBtn],
    ["copyAll", copyAllBtn],
    ["downloadAll", downloadAllBtn],
  ];
  const missing = required.filter(([, el]) => !el).map(([id]) => id);
  if (missing.length) {
    console.error("Missing required elements:", missing);
    alert("UI wiring error: missing element(s): " + missing.join(", "));
    return;
  }

  // ----- helpers -----
  function setStatus(text) {
    statusEl.innerHTML = `<span class="text-slate-600">${text || ""}</span>`;
  }

  function getDelimiter() {
    return "===CARD===";
  }

  function stripCodeFences(s) {
    return (s || "").replace(/```/g, "").trim();
  }

  function splitCards(text) {
    const d = getDelimiter();
    return stripCodeFences(text)
      .split(d)
      .map((x) => x.trim())
      .filter(Boolean);
  }

  function refreshStats() {
    const n = splitCards(bulkInput.value).length;
    inputStats.textContent = `${n} card${n === 1 ? "" : "s"} detected`;
  }

  function setActionsEnabled(on) {
    copyAllBtn.disabled = !on;
    downloadAllBtn.disabled = !on;
  }

  // ----- render -----
  function renderCards(cards) {
    outputs.innerHTML = "";

    if (!cards.length) {
      if (emptyState) outputs.appendChild(emptyState);
      setActionsEnabled(false);
      return;
    }

    setActionsEnabled(true);

    cards.forEach((text, idx) => {
      const wrap = document.createElement("div");
      wrap.className = "bg-white border border-slate-200 rounded-xl p-3 shadow-sm";

      const top = document.createElement("div");
      top.className = "flex items-center justify-between mb-2";

      const tag = document.createElement("div");
      tag.className =
        "text-xs font-semibold px-2.5 py-1 rounded-full bg-primary-50 text-primary-700";
      tag.textContent = `Card ${idx + 1}`;

      const copyBtn = document.createElement("button");
      copyBtn.className =
        "text-xs inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors";
      copyBtn.textContent = "Copy";
      copyBtn.onclick = async () => {
        await navigator.clipboard.writeText(text);
        setStatus(`Copied Card ${idx + 1}`);
      };

      const pre = document.createElement("pre");
      pre.className =
        "whitespace-pre-wrap font-mono text-sm leading-relaxed text-slate-800";
      pre.textContent = text;

      top.appendChild(tag);
      top.appendChild(copyBtn);
      wrap.appendChild(top);
      wrap.appendChild(pre);
      outputs.appendChild(wrap);
    });
  }

  // ----- actions -----
  async function refineAll() {
    const raw = bulkInput.value.trim();
    if (!raw) {
      setStatus("Paste cards first.");
      return;
    }

    refineAllBtn.disabled = true;
    setStatus("Refining cards…");

    try {
      const res = await fetch("/api/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: raw,
          model: modelEl.value,
          temperature: Number(tempEl.value),
          delimiter: getDelimiter(),
          extraRules: extraRulesEl?.value || "", // ✅ THIS is the override box
        }),
      });

      const bodyText = await res.text();
      if (!res.ok) throw new Error(bodyText);

      const j = JSON.parse(bodyText);
      const resultText = j.text ?? j.output ?? "";
      const cards = splitCards(resultText);

      renderCards(cards);
      setStatus(`Done — refined ${cards.length} card(s).`);
    } catch (err) {
      console.error(err);
      setStatus("Error: " + (err?.message || String(err)));
    } finally {
      refineAllBtn.disabled = false;
    }
  }

  // ----- wire up events -----
  bulkInput.style.caretColor = "#0f172a";

  bulkInput.addEventListener("input", refreshStats);
  refreshStats();

  clearBtn.addEventListener("click", (e) => {
    e.preventDefault();
    bulkInput.value = "";
    renderCards([]);
    refreshStats();
    setStatus("Cleared.");
    bulkInput.focus();
  });

  refineAllBtn.addEventListener("click", (e) => {
    e.preventDefault();
    refineAll();
  });

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.key === "Enter") refineAll();
  });

  autoInsertBtn.addEventListener("click", (e) => {
    e.preventDefault();

    const d = getDelimiter();
    const insert = `\n\n${d}\n\n`;

    const start = bulkInput.selectionStart ?? bulkInput.value.length;
    const end = bulkInput.selectionEnd ?? bulkInput.value.length;

    bulkInput.value =
      bulkInput.value.slice(0, start) + insert + bulkInput.value.slice(end);

    const pos = start + insert.length;
    bulkInput.focus();
    bulkInput.setSelectionRange(pos, pos);

    refreshStats();
  });

  copyAllBtn.addEventListener("click", async () => {
    const blocks = Array.from(outputs.querySelectorAll("pre")).map(
      (p) => p.textContent
    );
    if (!blocks.length) return setStatus("Nothing to copy.");

    const d = getDelimiter();
    await navigator.clipboard.writeText(blocks.join("\n\n" + d + "\n\n"));
    setStatus("Copied all cards.");
  });

  downloadAllBtn.addEventListener("click", () => {
    const blocks = Array.from(outputs.querySelectorAll("pre")).map(
      (p) => p.textContent
    );
    if (!blocks.length) return setStatus("Nothing to download.");

    const d = getDelimiter();
    const blob = new Blob([blocks.join("\n\n" + d + "\n\n")], {
      type: "text/plain",
    });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "refined_cards.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
    setStatus("Downloaded refined_cards.txt");
  });

  setActionsEnabled(false);
  setStatus("Ready to refine");

  // ============================
  // REWRITER TAB WIRING
  // ============================
  let rwPreset = "email";

  const ACTIVE_COLORS = {
  email: ["bg-primary-600", "text-white"],
  micro: ["bg-secondary-600", "text-white"],
  path: ["bg-purple-600", "text-white"]
};

const INACTIVE_COLORS = [
  "bg-slate-100",
  "text-slate-700",
  "hover:bg-slate-200"
];

  const rwInput = document.getElementById("rwInput");
  const rwOutput = document.getElementById("rwOutput");
  const rwRun = document.getElementById("rwRun");
  const rwClear = document.getElementById("rwClear");
  const rwRules = document.getElementById("rwRules");
  const rwPresetBtns = document.querySelectorAll(".rwPreset");

  // If the rewriter panel isn't on this page, don't crash.
  if (rwInput && rwOutput && rwRun && rwClear && rwRules) {
    if (!rwRules.value.trim()) {
      rwRules.value = `- Keep meaning identical
- Remove filler
- Keep qualifiers (e.g., focal, patchy, cannot exclude)
- No new facts`;
    }

rwPresetBtns.forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    rwPreset = btn.dataset.preset || "email";

    rwPresetBtns.forEach((b) => {
      b.classList.remove(
        "bg-primary-600",
        "text-white"
      );
      b.classList.add(
        "bg-slate-100",
        "text-slate-700",
        "hover:bg-slate-200"
      );
    });

    btn.classList.remove(
      "bg-slate-100",
      "text-slate-700",
      "hover:bg-slate-200"
    );
    btn.classList.add(
      "bg-primary-600",
      "text-white"
    );

    setStatus(`Rewriter mode: ${rwPreset}`);
  });
});


    rwClear.addEventListener("click", (e) => {
      e.preventDefault();
      rwInput.value = "";
      rwOutput.value = "";
      setStatus("Cleared rewriter.");
      rwInput.focus();
    });

    rwRun.addEventListener("click", async (e) => {
      e.preventDefault();

      const text = (rwInput.value || "").trim();
      if (!text) return setStatus("Paste text to rewrite first.");

      rwRun.disabled = true;
      setStatus("Rewriting…");

      try {
        const res = await fetch("/api/rewrite", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            model: modelEl?.value || "gpt-4.1-mini",
            temperature: Number(tempEl?.value) || 0.2,
            preset: rwPreset,
            rules: rwRules.value || "",
          }),
        });

        const bodyText = await res.text();
        if (!res.ok) throw new Error(bodyText);

        const j = JSON.parse(bodyText);
        rwOutput.value = (j.text ?? "").trim();
        setStatus("Done — rewritten.");
      } catch (err) {
        console.error("Rewriter error:", err);
        setStatus("Rewriter error: " + (err?.message || String(err)));
      } finally {
        rwRun.disabled = false;
      }
    });

const first = document.querySelector('.rwPreset[data-preset="email"]');
if (first) {
  first.classList.remove(
    "bg-slate-100",
    "text-slate-700",
    "hover:bg-slate-200"
  );
  first.classList.add(
    "bg-primary-600",
    "text-white"
  );
}

  }
});
