document.addEventListener("DOMContentLoaded", () => {
  // ============================
  // CLOZE REFINER TAB WIRING
  // ============================
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

  async function apiPostJson(url, payload, { timeoutMs = 30000, retryOn401 = true } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload || {}),
        signal: controller.signal,
      });

      const bodyText = await res.text();

      if (res.status === 401 && retryOn401) {
        await pingHealth({ silent: true });
        return apiPostJson(url, payload, { timeoutMs, retryOn401: false });
      }

      if (!res.ok) throw new Error(bodyText || `Request failed (${res.status})`);

      return bodyText ? JSON.parse(bodyText) : {};
    } catch (err) {
      if (err?.name === "AbortError") {
        throw new Error("Request timed out. If the app was idle, try again.");
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async function pingHealth({ silent = false } = {}) {
    try {
      const res = await fetch("/health", {
        method: "GET",
        cache: "no-store",
        credentials: "include",
      });

      if (!res.ok && !silent) {
        setStatus("Connection check failed. Reload and sign in again.");
      }
    } catch (_err) {
      if (!silent) {
        setStatus("Connection lost. Ensure server.js is still running.");
      }
    }
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
      copyBtn.type = "button";
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
      const j = await apiPostJson("/api/refine", {
        text: raw,
        model: modelEl.value,
        temperature: Number(tempEl.value),
        delimiter: getDelimiter(),
        extraRules: extraRulesEl?.value || "",
      });
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

  function bindEnterSendCtrlNewline(textarea, onSend) {
    if (!textarea) return;

    textarea.addEventListener(
      "keydown",
      (e) => {
        const isEnter = e.key === "Enter" || e.key === "NumpadEnter";
        if (!isEnter) return;

        const isCmdOrCtrl = e.ctrlKey || e.metaKey;

        // Ctrl/Cmd + Enter → newline
        if (isCmdOrCtrl) {
          e.preventDefault();
          e.stopImmediatePropagation();
          e.stopPropagation();

          const start = textarea.selectionStart ?? textarea.value.length;
          const end = textarea.selectionEnd ?? textarea.value.length;

          textarea.value =
            textarea.value.slice(0, start) + "\n" + textarea.value.slice(end);

          textarea.selectionStart = textarea.selectionEnd = start + 1;
          return;
        }

        // Enter alone → send/refine
        e.preventDefault();
        e.stopImmediatePropagation();
        e.stopPropagation();
        onSend();
      },
      true // capture
    );
  }

  // Apply to BOTH fields
  bindEnterSendCtrlNewline(bulkInput, refineAll);
  bindEnterSendCtrlNewline(extraRulesEl, refineAll);

  // ----- wire up events -----
  bulkInput.style.caretColor = "#0f172a";

  bulkInput.addEventListener("input", refreshStats);
  refreshStats();

  clearBtn.addEventListener("click", (e) => {
    e.preventDefault();
    bulkInput.value = "";
    if (extraRulesEl) extraRulesEl.value = "";
    renderCards([]);
    refreshStats();
    setStatus("Cleared.");
    bulkInput.focus();
  });

  refineAllBtn.addEventListener("click", (e) => {
    e.preventDefault();
    refineAll();
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
  // REWRITER TAB WIRING (UPDATED)
  // ============================
  let rwPreset = "general";
  let lastPreset = rwPreset;

  const ACTIVE_COLORS = {
    general: ["bg-slate-900", "text-white", "border", "border-slate-900", "shadow-sm"],
    email: ["bg-primary-600", "text-black", "border", "border-primary-600", "shadow-sm"],
    micro: ["bg-secondary-600", "text-white", "border", "border-secondary-600", "shadow-sm"],
    gross:   ["bg-rose-600", "text-white", "border", "border-rose-600", "shadow-sm"],
    path: ["bg-purple-600", "text-white", "border", "border-purple-600", "shadow-sm"],
  };

  const INACTIVE_COLORS = [
    "bg-white/70",
    "text-slate-700",
    "border",
    "border-slate-200",
    "shadow-sm",
  ];

  const rwInput = document.getElementById("rwInput");
  const rwOutput = document.getElementById("rwOutput");
  const rwRun = document.getElementById("rwRun");
  const rwClear = document.getElementById("rwClear");
  const rwRules = document.getElementById("rwRules");
  const rwKeepRules = document.getElementById("rwKeepRules");
  const rwPresetBtns = document.querySelectorAll(".rwPreset");
  const rwCopy = document.getElementById("rwCopy");

  if (rwInput && rwOutput && rwRun && rwClear && rwRules && rwCopy && rwPresetBtns.length) {
    // Preserve each preset button's original classes (padding/rounded/etc.)
    rwPresetBtns.forEach((btn) => {
      btn.dataset.baseClass = btn.className;
      btn.setAttribute("type", "button");
      btn.setAttribute("aria-pressed", "false"); // used by CSS to distinguish active/inactive hover
    });

    // Keep-rules toggle persistence
    const KEEP_RULES_KEY = "rwKeepRules";
    if (rwKeepRules) {
      rwKeepRules.checked = localStorage.getItem(KEEP_RULES_KEY) === "true";
      rwKeepRules.addEventListener("change", () => {
        localStorage.setItem(KEEP_RULES_KEY, String(rwKeepRules.checked));
      });
    }

    function setPlaceholdersForPreset(_preset) {
      rwInput.placeholder = "Ask anything or paste text here";
      rwRules.placeholder =
        "Optional: add constraints (tone, bullets, length, style). Leave empty for default behavior.";
    }

    function applyRulesForPreset(_preset) {
      // Do nothing — rules box is user-controlled.
    }

    function setRunButtonLabel(preset) {
      rwRun.textContent = preset === "general" ? "Send ➜" : "Refine ✨";
    }

    function setPresetActive(preset) {
      rwPresetBtns.forEach((b) => b.setAttribute("aria-pressed", "false"));

      rwPresetBtns.forEach((b) => {
        b.className = b.dataset.baseClass || b.className;
        b.classList.add(...INACTIVE_COLORS);
      });

      const activeBtn = document.querySelector(`.rwPreset[data-preset="${preset}"]`);
      if (activeBtn) {
        activeBtn.setAttribute("aria-pressed", "true");
        activeBtn.className = activeBtn.dataset.baseClass || activeBtn.className;
        activeBtn.classList.add(...(ACTIVE_COLORS[preset] || ACTIVE_COLORS.general));
      }
    }

    function clearRewriterFields({ clearRules } = { clearRules: true }) {
      rwInput.value = "";
      rwOutput.value = "";
      rwCopy.disabled = true;
      if (clearRules) rwRules.value = "";
    }

    // Enter = submit, Ctrl/Cmd + Enter = newline (rwInput)
    rwInput.addEventListener("keydown", (e) => {
      const isCmdOrCtrl = e.ctrlKey || e.metaKey;
      const isEnter = e.key === "Enter" || e.key === "NumpadEnter";
      if (!isEnter) return;

      if (isCmdOrCtrl) {
        e.preventDefault();
        const start = rwInput.selectionStart ?? rwInput.value.length;
        const end = rwInput.selectionEnd ?? rwInput.value.length;
        rwInput.value = rwInput.value.slice(0, start) + "\n" + rwInput.value.slice(end);
        rwInput.selectionStart = rwInput.selectionEnd = start + 1;
        return;
      }

      e.preventDefault();
      rwRun.click();
    });

    // Enter = submit, Ctrl/Cmd + Enter = newline (rwRules)
    rwRules.addEventListener("keydown", (e) => {
      const isCmdOrCtrl = e.ctrlKey || e.metaKey;
      const isEnter = e.key === "Enter" || e.key === "NumpadEnter";
      if (!isEnter) return;

      if (isCmdOrCtrl) {
        e.preventDefault();
        const start = rwRules.selectionStart ?? rwRules.value.length;
        const end = rwRules.selectionEnd ?? rwRules.value.length;
        rwRules.value = rwRules.value.slice(0, start) + "\n" + rwRules.value.slice(end);
        rwRules.selectionStart = rwRules.selectionEnd = start + 1;
        return;
      }

      e.preventDefault();
      rwRun.click();
    });

    // Copy output
    rwCopy.disabled = true;
    const rwCopyOriginal = { className: rwCopy.className, text: rwCopy.textContent };

    rwCopy.addEventListener("click", async () => {
      const text = (rwOutput.value || "").trim();
      if (!text) return;

      try {
        await navigator.clipboard.writeText(text);
        rwCopy.textContent = "Copied!";
        rwCopy.className = rwCopyOriginal.className + " bg-green-500 text-white";
        setStatus("Copied output to clipboard.");

        setTimeout(() => {
          rwCopy.textContent = rwCopyOriginal.text;
          rwCopy.className = rwCopyOriginal.className;
        }, 350);
      } catch (err) {
        console.error("Copy failed:", err);
        setStatus("Copy failed.");
      }
    });

    // Preset buttons (clear on change; keep rules if toggle on)
    rwPresetBtns.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const nextPreset = btn.dataset.preset || "general";

        if (nextPreset !== lastPreset) {
          const keepRules = rwKeepRules?.checked === true;
          clearRewriterFields({ clearRules: !keepRules });
          setStatus("");
        }

        rwPreset = nextPreset;
        lastPreset = nextPreset;

        setPresetActive(rwPreset);
        applyRulesForPreset(rwPreset);
        setPlaceholdersForPreset(rwPreset);
        setRunButtonLabel(rwPreset);

        setStatus(`Rewriter mode: ${rwPreset}`);
      });
    });

    // Clear (respects Keep toggle)
    rwClear.addEventListener("click", (e) => {
      e.preventDefault();
      const keepRules = rwKeepRules?.checked === true;
      clearRewriterFields({ clearRules: !keepRules });
      setStatus("Cleared rewriter.");
      rwInput.focus();
    });

    // Run
    rwRun.addEventListener("click", async (e) => {
      e.preventDefault();
      const text = (rwInput.value || "").trim();
      if (!text) return setStatus("Type a question or paste text first.");

      rwRun.disabled = true;
      rwRun.textContent = rwPreset === "general" ? "Sending…" : "Refining…";
      setStatus(rwPreset === "general" ? "Sending…" : "Refining…");

      try {
        const j = await apiPostJson("/api/rewrite", {
          text,
          model: modelEl?.value || "gpt-4.1-mini",
          temperature: Number(tempEl?.value) || 0.2,
          preset: rwPreset,
          rules: rwRules.value || "",
        });
        rwOutput.value = (j.text ?? "").trim();
        rwCopy.disabled = !rwOutput.value.trim();
        setStatus(rwPreset === "general" ? "Done — answered." : "Done — rewritten.");
      } catch (err) {
        console.error("Rewriter error:", err);
        setStatus("Rewriter error: " + (err?.message || String(err)));
      } finally {
        rwRun.disabled = false;
        setRunButtonLabel(rwPreset);
      }
    });

    // Default preset on load
    setPresetActive("general");
    applyRulesForPreset("general");
    setPlaceholdersForPreset("general");
    setRunButtonLabel("general");

    // Keep session warm so long-idle tabs still respond quickly.
    const keepAliveMs = 4 * 60 * 1000;
    const keepAliveId = window.setInterval(() => {
      pingHealth({ silent: true });
    }, keepAliveMs);

    window.addEventListener("beforeunload", () => {
      window.clearInterval(keepAliveId);
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") pingHealth({ silent: true });
    });

    pingHealth({ silent: true });
  } else {
    console.warn("Rewriter wiring skipped: missing elements or preset buttons not found.");
  }
});
