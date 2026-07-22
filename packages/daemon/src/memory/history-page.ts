/**
 * MF-05 T2.2a — Minimal static History page.
 *
 * Exported as a string constant (no static-file-path resolution required).
 * Served by http-routes.ts at GET /history.html.
 *
 * Design constraints (plan §T2.2a, ADR-0013 threat model):
 *   - Token is held in a plain JS variable ONLY — NEVER localStorage/sessionStorage/cookies.
 *   - All API-derived strings are inserted via textContent/createElement DOM building —
 *     NEVER innerHTML with API data (mirrors overlay text-reply.ts discipline).
 *   - No framework, no build step, no external resources.
 *   - History/memory slice ONLY — NOT an SPA, NO settings/plugins/devtools.
 */

/**
 * Paste-path token sanitizer (chunk-04 tail B). Single source of truth:
 * inlined verbatim into the served <script> below AND compiled in the unit test.
 * Tolerates the zsh no-newline "%" marker + surrounding whitespace/quotes that
 * ride along when a token is copied from a terminal. Format-agnostic (does NOT
 * assume hex) so a future token format is unaffected; the real gate stays the
 * server-side constant-time compare (token-store.ts).
 */
export const SANITIZE_TOKEN_FN = `function sanitizeToken(raw) {
  if (typeof raw !== "string") return "";
  var t = raw.trim();
  t = t.replace(/%+$/, "").trim();            // zsh no-newline marker(s)
  t = t.replace(/^["']+|["']+$/g, "").trim(); // surrounding quotes
  return t;
}`;

export const HISTORY_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>History</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      color: #1a1a1a;
      background: #f5f5f5;
      padding: 16px;
    }
    h1 { font-size: 20px; font-weight: 600; margin-bottom: 16px; }
    h2 { font-size: 15px; font-weight: 600; margin: 16px 0 8px; }
    h3 { font-size: 13px; font-weight: 600; margin: 12px 0 6px; color: #555; }
    .panel {
      background: #fff;
      border: 1px solid #ddd;
      border-radius: 6px;
      padding: 14px;
      margin-bottom: 12px;
    }
    .thread-list { list-style: none; }
    .thread-list li {
      padding: 8px 10px;
      cursor: pointer;
      border-radius: 4px;
      border: 1px solid #e8e8e8;
      margin-bottom: 6px;
      background: #fafafa;
    }
    .thread-list li:hover { background: #eef4ff; border-color: #c0d4f5; }
    .thread-title { font-weight: 500; }
    .thread-meta { color: #888; font-size: 12px; margin-top: 2px; }
    .message-row {
      padding: 6px 8px;
      margin-bottom: 6px;
      border-left: 3px solid #ddd;
      background: #fafafa;
      border-radius: 0 4px 4px 0;
    }
    .message-row.role-user { border-color: #6b9ef4; }
    .message-row.role-assistant { border-color: #84c47a; }
    .message-role { font-size: 11px; font-weight: 600; text-transform: uppercase;
                    color: #888; margin-bottom: 2px; }
    .message-content { white-space: pre-wrap; word-break: break-word; }
    .fact-row, .event-row {
      padding: 6px 8px;
      margin-bottom: 4px;
      background: #fafafa;
      border: 1px solid #eee;
      border-radius: 4px;
    }
    .fact-meta { font-size: 11px; color: #999; margin-top: 2px; }
    .event-row .facts-count { font-weight: 600; }
    .zero-count { color: #e07b00; }
    .btn {
      display: inline-block;
      padding: 3px 8px;
      font-size: 12px;
      border: 1px solid #ccc;
      border-radius: 4px;
      cursor: pointer;
      background: #fff;
      margin-left: 6px;
    }
    .btn:hover { background: #f0f0f0; }
    .btn-forget { border-color: #e07070; color: #c03030; }
    .btn-forget:hover { background: #fff0f0; }
    .btn-forget[disabled] { border-color: #ddd; color: #aaa; cursor: default; }
    .btn-forget[disabled]:hover { background: #fff; }
    .btn-danger { border-color: #c03030; color: #c03030; background: #fff0f0; }
    .btn-danger:hover { background: #ffe0e0; }
    .btn-cancel { border-color: #999; color: #555; }
    .btn-cancel:hover { background: #f0f0f0; }
    .inline-confirm { display: inline; margin-left: 4px; }
    .inline-hint { font-size: 12px; color: #c03030; margin-left: 6px; }
    .inline-unlock-hint {
      display: inline-block;
      font-size: 12px;
      color: #a06000;
      background: #fffbe6;
      border: 1px solid #f0d060;
      border-radius: 4px;
      padding: 2px 8px;
      margin-left: 6px;
    }
    .unlock-panel { background: #fffbe6; border-color: #f0d060; }
    .unlock-hint { font-size: 12px; color: #888; margin-top: 6px; }
    .token-input {
      width: 100%;
      max-width: 440px;
      padding: 5px 8px;
      font-family: monospace;
      font-size: 13px;
      border: 1px solid #ccc;
      border-radius: 4px;
      margin-top: 6px;
    }
    .unlock-status { font-size: 12px; margin-top: 4px; }
    .status-ok { color: #2a7a2a; }
    .status-err { color: #b02020; }
    #thread-view { display: none; }
    .back-btn { margin-bottom: 12px; font-size: 13px; cursor: pointer;
                color: #2060b0; background: none; border: none; padding: 0; }
    .back-btn:hover { text-decoration: underline; }
    .empty { color: #aaa; font-style: italic; font-size: 13px; }
    .section-head { display: flex; align-items: center; gap: 8px; }
    .erased-banner { padding: 10px 12px; margin-bottom: 10px; background: #fff8f0; border: 1px solid #f0c8a0; border-radius: 6px; color: #a05000; font-size: 13px; }
  </style>
</head>
<body>
  <h1>History</h1>

  <!-- Unlock writes section: token is held in a JS variable only, never web storage -->
  <div class="panel unlock-panel" id="unlock-section">
    <h2>Unlock writes</h2>
    <p>Paste your auth token to enable forget actions.</p>
    <input
      type="password"
      class="token-input"
      id="token-input"
      placeholder="paste token here"
      autocomplete="off"
    />
    <button class="btn" id="unlock-btn">Unlock</button>
    <div class="unlock-hint">
      Token location:
      <code id="token-path">~/.agentic-engine/auth-token</code>
      (or <code>$AGENTIC_DATA_DIR/auth-token</code>)
    </div>
    <div class="unlock-status" id="unlock-status"></div>
  </div>

  <!-- Thread list -->
  <div id="thread-list-view">
    <div class="panel">
      <h2>Threads</h2>
      <ul class="thread-list" id="thread-list"><li class="empty locked">&#128274; Locked &mdash; paste your auth token above to view your memory.</li></ul>
    </div>
  </div>

  <!-- Thread detail view -->
  <div id="thread-view">
    <button class="back-btn" id="back-btn">&#8592; Back to threads</button>

    <div class="panel">
      <div class="section-head"><h2>Messages</h2><span id="thread-forget-control"></span></div>
      <div id="erased-banner"></div>
      <div id="messages-container"><p class="empty">Loading…</p></div>
    </div>

    <div class="panel">
      <div class="section-head"><h2>Distilled facts</h2></div>
      <div id="facts-container"><p class="empty">Loading…</p></div>
    </div>

    <div class="panel">
      <div class="section-head"><h2>Distillation events</h2></div>
      <div id="events-container"><p class="empty">Loading…</p></div>
    </div>
  </div>

  <script>
    // ── Token state — held ONLY in this JS variable, never web storage ──────────
    // ADR-0013 threat model: a cross-site tab must not be able to steal the token.
    // Web storage (sessionStorage, cookies, etc.) is explicitly forbidden (plan §T2.2a).
    // The token is in-memory only: a separate-origin tab cannot read a JS variable.
    var _authToken = null; // eslint-disable-line no-var

    // ── Paste-path token sanitizer (chunk-04 tail B) ─────────────────────────────
    ${SANITIZE_TOKEN_FN}

    // ── DOM refs ─────────────────────────────────────────────────────────────────
    var tokenInput = document.getElementById("token-input");
    var unlockBtn = document.getElementById("unlock-btn");
    var unlockStatus = document.getElementById("unlock-status");
    var threadList = document.getElementById("thread-list");
    var threadListView = document.getElementById("thread-list-view");
    var threadView = document.getElementById("thread-view");
    var messagesContainer = document.getElementById("messages-container");
    var factsContainer = document.getElementById("facts-container");
    var eventsContainer = document.getElementById("events-container");
    var backBtn = document.getElementById("back-btn");

    var _currentThreadId = null;

    // ── Unlock ────────────────────────────────────────────────────────────────────
    unlockBtn.addEventListener("click", function () {
      var val = sanitizeToken(tokenInput.value); // chunk-04 tail B (was: .trim())
      if (!val) {
        setStatus("Enter a token first.", false);
        return;
      }
      // Token stored in a JS variable only — not in any web storage API
      _authToken = val;
      tokenInput.value = "";
      setStatus("Token set for this session.", true);
      // Load thread list now that the token is set (data gate; spec §3.5 / chunk 03)
      loadThreadList();
    });

    function setStatus(msg, ok) {
      unlockStatus.className = "unlock-status " + (ok ? "status-ok" : "status-err");
      unlockStatus.textContent = msg;
    }

    // ── Thread list ───────────────────────────────────────────────────────────────
    function loadThreadList() {
      fetch("/memory/threads", { headers: { "Authorization": "Bearer " + _authToken } })
        .then(function (r) {
          if (r.status === 401) {
            // Honest: unauthorized, NOT "no threads". (ADR-0012 5a / ADR-0013 read-gate.)
            renderLocked("Unauthorized — check the token you pasted.");
            setStatus("401 — bad or missing token.", false);
            return null;
          }
          return r.json();
        })
        .then(function (data) {
          if (data === null) return;              // 401 already handled
          renderThreadList(data.threads || []);   // 200: real list or honest "No threads yet."
        })
        .catch(function () {
          // Honest daemon-down / network error, NOT "no threads".
          clearChildren(threadList);
          var li = document.createElement("li");
          li.className = "empty";
          li.textContent = "Couldn’t reach the daemon — is it running?";
          threadList.appendChild(li);
        });
    }

    function renderLocked(msg) {
      clearChildren(threadList);
      var li = document.createElement("li");
      li.className = "empty locked";
      li.textContent = "🔒 " + (msg || "Locked — paste your auth token above to view your memory.");
      threadList.appendChild(li);
    }

    function renderThreadList(threads) {
      clearChildren(threadList);
      if (threads.length === 0) {
        var li = document.createElement("li");
        li.className = "empty";
        li.textContent = "No threads yet.";
        threadList.appendChild(li);
        return;
      }
      threads.forEach(function (t) {
        var li = document.createElement("li");
        var titleEl = document.createElement("div");
        titleEl.className = "thread-title";
        // XSS: textContent only — never innerHTML with API data
        titleEl.textContent = t.title || t.thread_id;
        var metaEl = document.createElement("div");
        metaEl.className = "thread-meta";
        metaEl.textContent = t.thread_id + " · " + formatDate(t.last_active_at);
        li.appendChild(titleEl);
        li.appendChild(metaEl);
        li.addEventListener("click", function () { openThread(t.thread_id); });
        threadList.appendChild(li);
      });
    }

    // ── Thread detail ─────────────────────────────────────────────────────────────
    function openThread(threadId) {
      _currentThreadId = threadId;
      threadListView.style.display = "none";
      threadView.style.display = "block";
      loadThread(threadId);
    }

    function loadThread(threadId) {
      fetch("/memory/thread/" + encodeURIComponent(threadId), { headers: { "Authorization": "Bearer " + _authToken } })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          renderMessages(data.messages || [], threadId);
          renderFacts(data.distilledFacts || []);
          renderEvents(data.distillationEvents || []);
          renderThreadControls(data.thread, threadId, (data.messages || []).length);
        })
        .catch(function () {
          clearChildren(messagesContainer);
          var p = document.createElement("p");
          p.className = "empty";
          p.textContent = "Failed to load thread.";
          messagesContainer.appendChild(p);
        });
    }

    function renderThreadControls(thread, threadId, messageCount) {
      var control = document.getElementById("thread-forget-control");
      var banner = document.getElementById("erased-banner");
      clearChildren(control); clearChildren(banner);
      // NIT-1: a nonexistent thread (hatch.view returns thread:null) gets NO control and NO
      // banner — a THIRD, do-nothing case, distinct from both "forgotten" and "live". Without
      // this, thread && (...) below short-circuits to false on null and falls through to the
      // LIVE branch, wrongly rendering a destructive "Forget conversation" button.
      if (!thread) return;
      if (thread.status === "forgotten") {
        // Erased husk (terminal): banner, no forget button. §7 architect-latitude on copy (Fork E1 — no
        // fabricated date; the frozen 3-field meta carries no erase timestamp).
        var b = document.createElement("div");
        b.className = "erased-banner";
        b.textContent = "You erased this conversation's content. Distilled facts remain.";
        banner.appendChild(b);
        return;
      }
      // Live/active/dismissed thread → the destructive control (deliberate-destruction UX: it lives in
      // the detail view where the user sees what they will erase — §0.1).
      var btn = document.createElement("button");
      btn.className = "btn btn-forget";
      btn.textContent = "Forget conversation";
      // FROZEN §0.2 copy [q#019 rider 3] — verbatim, with the REAL message count at confirm time.
      var confirmHint = "Erase this conversation's content (" + messageCount + " messages)? Distilled facts remain. Cannot be undone.";
      btn.addEventListener("click", function () {
        doForget({ target_type: "thread", thread_id: threadId }, threadId, btn, "Forget conversation", "Confirm erase?", confirmHint);
      });
      control.appendChild(btn);
    }

    function renderMessages(messages, threadId) {
      clearChildren(messagesContainer);
      if (messages.length === 0) {
        var p = document.createElement("p");
        p.className = "empty";
        p.textContent = "No messages.";
        messagesContainer.appendChild(p);
        return;
      }
      messages.forEach(function (m, idx) {
        var row = document.createElement("div");
        row.className = "message-row role-" + (m.role || "unknown");

        var roleEl = document.createElement("div");
        roleEl.className = "message-role";
        // textContent only — API data never goes into innerHTML
        roleEl.textContent = (m.role || "?") + " · turn " + (idx + 1);

        var contentEl = document.createElement("div");
        contentEl.className = "message-content";
        contentEl.textContent = m.content || "";

        // v2-04: per-message "Forget" button removed (D-V6a-bis). hybrid-retrieval chunk-01
        // (spec §3.7 R1): the per-message "Edit" button is ALSO removed — archive is read-only
        // immutable history; fact-forget (below) is the ONLY write action left in history.html.
        // (Fact-edit is overlay-only — history.html never had a fact-edit affordance.)
        row.appendChild(roleEl);
        row.appendChild(contentEl);
        messagesContainer.appendChild(row);
      });
    }

    function renderFacts(facts) {
      clearChildren(factsContainer);
      if (facts.length === 0) {
        var p = document.createElement("p");
        p.className = "empty";
        p.textContent = "No distilled facts.";
        factsContainer.appendChild(p);
        return;
      }
      facts.forEach(function (f) {
        var row = document.createElement("div");
        row.className = "fact-row";

        var factEl = document.createElement("div");
        factEl.textContent = f.fact || "";

        var metaEl = document.createElement("div");
        metaEl.className = "fact-meta";
        // textContent only for all API-derived values
        var metaParts = [];
        if (f.provenance) metaParts.push("provenance: " + f.provenance);
        if (f.scope) metaParts.push("scope: " + f.scope);
        if (f.authored_by) metaParts.push("authored_by: " + f.authored_by);
        metaEl.textContent = metaParts.join(" · ");

        var forgetBtn = document.createElement("button");
        forgetBtn.className = "btn btn-forget";
        forgetBtn.textContent = "Forget fact";
        // v2-04: fact-forget only — sends target_type:"fact" + fact_text + provenance.
        // Option B ("also delete source message(s)") removed (D-V6a-bis).
        // Provenance stays as a READ affordance ("dig deeper") — never a delete target.
        forgetBtn.addEventListener("click", (function (factId, factText, provenance, btn) {
          return function () {
            doForget(
              { target_type: "fact", fact_id: factId, fact_text: factText, provenance: provenance, reason: "hatch-forget" },
              _currentThreadId, btn, "Forget fact"
            );
          };
        })(f.id, f.fact, f.provenance, forgetBtn));

        row.appendChild(factEl);
        row.appendChild(metaEl);
        row.appendChild(forgetBtn);
        factsContainer.appendChild(row);
      });
    }

    function renderEvents(events) {
      clearChildren(eventsContainer);
      if (events.length === 0) {
        var p = document.createElement("p");
        p.className = "empty";
        p.textContent = "No distillation events.";
        eventsContainer.appendChild(p);
        return;
      }
      events.forEach(function (e) {
        var row = document.createElement("div");
        row.className = "event-row";

        var countEl = document.createElement("span");
        countEl.className = "facts-count" + (e.facts_produced === 0 ? " zero-count" : "");
        countEl.textContent = e.facts_produced === 0
          ? "0 facts (deliberately retained nothing)"
          : e.facts_produced + " facts produced";

        var line = document.createElement("div");
        // All values inserted via textContent
        var triggerEl = document.createElement("span");
        triggerEl.textContent = "trigger: " + (e.trigger || "?") + " · ";
        line.appendChild(triggerEl);
        line.appendChild(countEl);

        var dateEl = document.createElement("div");
        dateEl.style.fontSize = "11px";
        dateEl.style.color = "#aaa";
        dateEl.textContent = formatDate(e.created_at);

        row.appendChild(line);
        row.appendChild(dateEl);
        eventsContainer.appendChild(row);
      });
    }

    // ── Write actions ─────────────────────────────────────────────────────────────

    // doForget: two-step inline confirm.
    // First click arms the button (danger style + "Confirm forget?" label + Cancel).
    // Second click (or timeout) executes or resets.
    // v2-04: bodyObj is always target_type:"fact" (fact-forget only; message-forget removed).
    // originalLabel is the button's resting text (so reset restores the right label).
    function doForget(bodyObj, threadId, forgetBtn, originalLabel, armedLabel, confirmHint) {
      if (!_authToken) {
        showUnlockHint(forgetBtn);
        return;
      }
      // Already in armed state — execute
      if (forgetBtn.dataset.armed === "1") return;

      // Arm: replace button label + style, add Cancel
      forgetBtn.dataset.armed = "1";
      forgetBtn.textContent = armedLabel || "Confirm forget?";
      forgetBtn.className = "btn btn-danger";

      var cancelBtn = document.createElement("button");
      cancelBtn.className = "btn btn-cancel inline-confirm";
      cancelBtn.textContent = "Cancel";

      var hint = document.createElement("span");
      hint.className = "inline-hint";
      hint.textContent = confirmHint || "Cannot be undone";

      var parent = forgetBtn.parentNode;
      parent.insertBefore(cancelBtn, forgetBtn.nextSibling);
      parent.insertBefore(hint, cancelBtn.nextSibling);

      var label = originalLabel || "Forget";
      var resetForget = function () {
        forgetBtn.dataset.armed = "";
        forgetBtn.textContent = label;
        forgetBtn.className = "btn btn-forget";
        if (cancelBtn.parentNode) cancelBtn.parentNode.removeChild(cancelBtn);
        if (hint.parentNode) hint.parentNode.removeChild(hint);
        clearTimeout(timer);
      };

      cancelBtn.addEventListener("click", resetForget);

      // Auto-reset after 5 s if user does nothing
      var timer = setTimeout(resetForget, 5000);

      forgetBtn.addEventListener("click", function executeForget() {
        forgetBtn.removeEventListener("click", executeForget);
        clearTimeout(timer);
        if (cancelBtn.parentNode) cancelBtn.parentNode.removeChild(cancelBtn);
        if (hint.parentNode) hint.parentNode.removeChild(hint);
        forgetBtn.disabled = true;
        forgetBtn.textContent = "Forgetting…";

        fetch("/memory/forget", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + _authToken,
          },
          body: JSON.stringify(bodyObj),
        }).then(function (r) {
          if (r.status === 204) {
            loadThread(threadId);
          } else if (r.status === 401) {
            setStatus("401 — unlock first or bad token.", false);
            resetForget();
          } else if (r.status === 409) {
            setStatus("This conversation is open — close it first.", false);   // [critic m8] honest, not raw "Error: 409"
            resetForget();
          } else {
            setStatus("Error: " + r.status, false);
            resetForget();
          }
        });
      }, { once: true });
    }

    // v2-04: option-B (also-delete-source-messages) removed end-to-end (D-V6a-bis).
    // The "Forget fact" button uses doForget with target_type:"fact" only.
    // hybrid-retrieval chunk-01 (spec §3.7 R1): doEdit (the message-edit inline textarea
    // editor) is REMOVED — archive is read-only immutable history; fact-forget above is
    // the ONLY write action left in history.html.

    // showUnlockHint: non-blocking inline message when writes are locked.
    // Highlights the unlock section + shows a transient message near the button.
    function showUnlockHint(nearBtn) {
      var unlockSection = document.getElementById("unlock-section");
      if (unlockSection) {
        unlockSection.style.outline = "2px solid #f0c040";
        setTimeout(function () { unlockSection.style.outline = ""; }, 2000);
      }
      // Avoid duplicate hints
      if (nearBtn.nextSibling && nearBtn.nextSibling.className === "inline-unlock-hint") return;
      var hintEl = document.createElement("span");
      hintEl.className = "inline-unlock-hint";
      hintEl.textContent = "Unlock writes first — paste your auth token above";
      nearBtn.parentNode.insertBefore(hintEl, nearBtn.nextSibling);
      setTimeout(function () {
        if (hintEl.parentNode) hintEl.parentNode.removeChild(hintEl);
      }, 3000);
    }

    // ── Back button ───────────────────────────────────────────────────────────────
    backBtn.addEventListener("click", function () {
      _currentThreadId = null;
      threadView.style.display = "none";
      threadListView.style.display = "block";
      loadThreadList();
    });

    // ── Utilities ─────────────────────────────────────────────────────────────────
    function clearChildren(el) {
      while (el.firstChild) el.removeChild(el.firstChild);
    }

    function formatDate(ts) {
      if (!ts) return "—";
      try {
        return new Date(typeof ts === "number" ? ts : Number(ts)).toLocaleString();
      } catch (_) {
        return String(ts);
      }
    }

    // ── Bootstrap ────────────────────────────────────────────────────────────────
    // NOTE: loadThreadList() is NOT called here — it is deferred to the Unlock handler
    // so data does NOT render pre-paste (spec §3.5 / chunk 03 / ADR-0013 read-gate).
  </script>
</body>
</html>
`;
