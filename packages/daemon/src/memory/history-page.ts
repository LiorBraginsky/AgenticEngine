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
    .btn-edit { border-color: #70a0e0; color: #2060b0; }
    .btn-edit:hover { background: #f0f4ff; }
    .btn-danger { border-color: #c03030; color: #c03030; background: #fff0f0; }
    .btn-danger:hover { background: #ffe0e0; }
    .btn-cancel { border-color: #999; color: #555; }
    .btn-cancel:hover { background: #f0f0f0; }
    .btn-save { border-color: #2a7a2a; color: #2a7a2a; }
    .btn-save:hover { background: #f0fff0; }
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
    .inline-editor {
      margin-top: 6px;
    }
    .inline-editor textarea {
      width: 100%;
      min-height: 60px;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 13px;
      padding: 5px 8px;
      border: 1px solid #70a0e0;
      border-radius: 4px;
      resize: vertical;
    }
    .inline-editor-actions { margin-top: 4px; }
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
  </style>
</head>
<body>
  <h1>History</h1>

  <!-- Unlock writes section: token is held in a JS variable only, never web storage -->
  <div class="panel unlock-panel" id="unlock-section">
    <h2>Unlock writes</h2>
    <p>Paste your auth token to enable edit and forget actions.</p>
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
      <ul class="thread-list" id="thread-list"><li class="empty">Loading…</li></ul>
    </div>
  </div>

  <!-- Thread detail view -->
  <div id="thread-view">
    <button class="back-btn" id="back-btn">&#8592; Back to threads</button>

    <div class="panel">
      <div class="section-head"><h2>Messages</h2></div>
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
      var val = tokenInput.value.trim();
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
        .then(function (r) { return r.json(); })
        .then(function (data) { renderThreadList(data.threads || []); })
        .catch(function (err) {
          clearChildren(threadList);
          var li = document.createElement("li");
          li.className = "empty";
          li.textContent = "Failed to load threads.";
          threadList.appendChild(li);
        });
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
        })
        .catch(function () {
          clearChildren(messagesContainer);
          var p = document.createElement("p");
          p.className = "empty";
          p.textContent = "Failed to load thread.";
          messagesContainer.appendChild(p);
        });
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

        var actions = document.createElement("div");
        actions.style.marginTop = "4px";

        var forgetBtn = document.createElement("button");
        forgetBtn.className = "btn btn-forget";
        forgetBtn.textContent = "Forget";
        // chunk 04: intent-per-button — message forget sends target_type:"message"
        forgetBtn.addEventListener("click", (function (msgId, btn) {
          return function () {
            doForget({ target_type: "message", target: msgId, reason: "hatch-forget" }, threadId, btn, "Forget");
          };
        })(m.id, forgetBtn));

        var editBtn = document.createElement("button");
        editBtn.className = "btn btn-edit";
        editBtn.textContent = "Edit";
        editBtn.addEventListener("click", (function (msgId, curContent, btn, r) {
          return function () { doEdit(msgId, curContent, threadId, btn, r); };
        })(m.id, m.content, editBtn, row));

        actions.appendChild(forgetBtn);
        actions.appendChild(editBtn);

        row.appendChild(roleEl);
        row.appendChild(contentEl);
        row.appendChild(actions);
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
        // chunk 04: intent-per-button — fact forget sends target_type:"fact" + fact_text + provenance
        forgetBtn.addEventListener("click", (function (factText, provenance, btn) {
          return function () {
            doForget(
              { target_type: "fact", fact_text: factText, provenance: provenance, reason: "hatch-forget" },
              _currentThreadId, btn, "Forget fact"
            );
          };
        })(f.fact, f.provenance, forgetBtn));

        // Option-B control: "also delete source messages"
        // Only meaningful when the provenance contains message-id(s), not just thread:<id>
        var optionBBtn = document.createElement("button");
        optionBBtn.className = "btn btn-forget";
        optionBBtn.style.marginLeft = "4px";
        var sourceCount = (f.provenance || "").split(",").map(function(p) { return p.trim(); })
          .filter(function(p) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p); }).length;
        if (sourceCount === 0) {
          // thread:<id> provenance — disable with explanatory copy
          optionBBtn.textContent = "no source messages to delete";
          optionBBtn.disabled = true;
          optionBBtn.style.color = "#aaa";
          optionBBtn.style.borderColor = "#ddd";
        } else {
          optionBBtn.textContent = "⚠ also delete " + sourceCount + " source message(s)";
          // chunk 04 option-B confirm: fetch co-fed count then show armed confirm
          optionBBtn.addEventListener("click", (function (factText, provenance, btn) {
            return function () {
              doForgetFactAndSources(factText, provenance, _currentThreadId, btn, sourceCount);
            };
          })(f.fact, f.provenance, optionBBtn));
        }

        row.appendChild(factEl);
        row.appendChild(metaEl);
        row.appendChild(forgetBtn);
        row.appendChild(optionBBtn);
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
    // chunk 04: bodyObj is the full POST body (target_type:"message" or target_type:"fact").
    // originalLabel is the button's resting text (so reset restores the right label).
    function doForget(bodyObj, threadId, forgetBtn, originalLabel) {
      if (!_authToken) {
        showUnlockHint(forgetBtn);
        return;
      }
      // Already in armed state — execute
      if (forgetBtn.dataset.armed === "1") return;

      // Arm: replace button label + style, add Cancel
      forgetBtn.dataset.armed = "1";
      forgetBtn.textContent = "Confirm forget?";
      forgetBtn.className = "btn btn-danger";

      var cancelBtn = document.createElement("button");
      cancelBtn.className = "btn btn-cancel inline-confirm";
      cancelBtn.textContent = "Cancel";

      var hint = document.createElement("span");
      hint.className = "inline-hint";
      hint.textContent = "Cannot be undone";

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
          } else {
            setStatus("Error: " + r.status, false);
            resetForget();
          }
        });
      }, { once: true });
    }

    // doForgetFactAndSources: option-B two-step confirm.
    // Fetches the exact co-fed count via GET /memory/cofed before showing the confirm.
    // Shows: "Confirm? Delete Nsrc source message(s). Ncofed other fact(s) also use these messages."
    function doForgetFactAndSources(factText, provenance, threadId, btn, sourceCount) {
      if (!_authToken) {
        showUnlockHint(btn);
        return;
      }
      if (btn.dataset.armed === "1") return;
      btn.dataset.armed = "1";
      btn.textContent = "Fetching…";
      btn.disabled = true;

      // Fetch exact co-fed count from the daemon
      fetch("/memory/cofed?provenance=" + encodeURIComponent(provenance) + "&exclude=" + encodeURIComponent(factText), {
        headers: { "Authorization": "Bearer " + _authToken },
      }).then(function(r) {
        return r.ok ? r.json() : { count: "?" };
      }).then(function(data) {
        btn.disabled = false;
        var cofedCount = data.count;
        btn.textContent = "Confirm? Delete " + sourceCount + " source msg(s). " + cofedCount + " other fact(s) also use these messages.";
        btn.className = "btn btn-danger";

        var cancelBtn = document.createElement("button");
        cancelBtn.className = "btn btn-cancel inline-confirm";
        cancelBtn.textContent = "Cancel";

        var hint = document.createElement("span");
        hint.className = "inline-hint";
        hint.textContent = "This also scrubs the source messages";

        var parent = btn.parentNode;
        parent.insertBefore(cancelBtn, btn.nextSibling);
        parent.insertBefore(hint, cancelBtn.nextSibling);

        var resetBtn = function() {
          btn.dataset.armed = "";
          btn.textContent = "⚠ also delete " + sourceCount + " source message(s)";
          btn.className = "btn btn-forget";
          if (cancelBtn.parentNode) cancelBtn.parentNode.removeChild(cancelBtn);
          if (hint.parentNode) hint.parentNode.removeChild(hint);
          clearTimeout(timer);
        };

        cancelBtn.addEventListener("click", resetBtn);
        var timer = setTimeout(resetBtn, 7000);

        btn.addEventListener("click", function executeOptionB() {
          btn.removeEventListener("click", executeOptionB);
          clearTimeout(timer);
          if (cancelBtn.parentNode) cancelBtn.parentNode.removeChild(cancelBtn);
          if (hint.parentNode) hint.parentNode.removeChild(hint);
          btn.disabled = true;
          btn.textContent = "Deleting…";

          fetch("/memory/forget", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": "Bearer " + _authToken,
            },
            body: JSON.stringify({ target_type: "fact", fact_text: factText, provenance: provenance, also_forget_sources: true, reason: "hatch-forget" }),
          }).then(function (r) {
            if (r.status === 204) {
              loadThread(threadId);
            } else if (r.status === 401) {
              setStatus("401 — unlock first or bad token.", false);
              resetBtn();
            } else {
              setStatus("Error: " + r.status, false);
              resetBtn();
            }
          });
        }, { once: true });

      }).catch(function() {
        btn.dataset.armed = "";
        btn.textContent = "⚠ also delete " + sourceCount + " source message(s)";
        btn.disabled = false;
        setStatus("Error fetching co-fed count.", false);
      });
    }

    // doEdit: inline textarea editor.
    // Clicking Edit reveals a textarea pre-filled with current content + Save/Cancel.
    function doEdit(msgId, currentContent, threadId, editBtn, row) {
      if (!_authToken) {
        showUnlockHint(editBtn);
        return;
      }
      // If editor already open for this row, ignore
      if (row.querySelector(".inline-editor")) return;

      editBtn.disabled = true;

      var editorDiv = document.createElement("div");
      editorDiv.className = "inline-editor";

      var ta = document.createElement("textarea");
      ta.textContent = currentContent || "";

      var actionsDiv = document.createElement("div");
      actionsDiv.className = "inline-editor-actions";

      var saveBtn = document.createElement("button");
      saveBtn.className = "btn btn-save";
      saveBtn.textContent = "Save";

      var cancelBtn = document.createElement("button");
      cancelBtn.className = "btn btn-cancel";
      cancelBtn.style.marginLeft = "6px";
      cancelBtn.textContent = "Cancel";

      actionsDiv.appendChild(saveBtn);
      actionsDiv.appendChild(cancelBtn);
      editorDiv.appendChild(ta);
      editorDiv.appendChild(actionsDiv);
      row.appendChild(editorDiv);
      ta.focus();

      var closeEditor = function () {
        editBtn.disabled = false;
        if (editorDiv.parentNode) editorDiv.parentNode.removeChild(editorDiv);
      };

      cancelBtn.addEventListener("click", closeEditor);

      saveBtn.addEventListener("click", function () {
        var replacement = ta.value;
        saveBtn.disabled = true;
        saveBtn.textContent = "Saving…";

        fetch("/memory/edit", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + _authToken,
          },
          body: JSON.stringify({ target: msgId, replacement: replacement, reason: "hatch-edit" }),
        }).then(function (r) {
          if (r.status === 204) {
            loadThread(threadId);
          } else if (r.status === 401) {
            setStatus("401 — unlock first or bad token.", false);
            closeEditor();
          } else {
            setStatus("Error: " + r.status, false);
            closeEditor();
          }
        });
      });
    }

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
