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
    .btn-edit { border-color: #70a0e0; color: #2060b0; }
    .btn-edit:hover { background: #f0f4ff; }
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
    });

    function setStatus(msg, ok) {
      unlockStatus.className = "unlock-status " + (ok ? "status-ok" : "status-err");
      unlockStatus.textContent = msg;
    }

    // ── Thread list ───────────────────────────────────────────────────────────────
    function loadThreadList() {
      fetch("/memory/threads")
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
      fetch("/memory/thread/" + encodeURIComponent(threadId))
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
        forgetBtn.addEventListener("click", (function (msgId) {
          return function () { doForget(msgId, threadId); };
        })(m.id));

        var editBtn = document.createElement("button");
        editBtn.className = "btn btn-edit";
        editBtn.textContent = "Edit";
        editBtn.addEventListener("click", (function (msgId, curContent) {
          return function () { doEdit(msgId, curContent, threadId); };
        })(m.id, m.content));

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
        // Per-fact forget uses the provenance value as the target
        forgetBtn.addEventListener("click", (function (provenance) {
          return function () { doForget(provenance, _currentThreadId); };
        })(f.provenance));

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
    function doForget(target, threadId) {
      if (!_authToken) {
        alert("Unlock writes first (paste your auth token above).");
        return;
      }
      if (!confirm("Forget \\\"" + target + "\\\"? This cannot be undone.")) return;
      fetch("/memory/forget", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + _authToken,
        },
        body: JSON.stringify({ target: target, reason: "hatch-forget" }),
      }).then(function (r) {
        if (r.status === 204) {
          loadThread(threadId);
        } else if (r.status === 403) {
          setStatus("403 — unlock first or bad token.", false);
        } else {
          setStatus("Error: " + r.status, false);
        }
      });
    }

    function doEdit(msgId, currentContent, threadId) {
      if (!_authToken) {
        alert("Unlock writes first (paste your auth token above).");
        return;
      }
      var replacement = prompt("Edit message content:", currentContent);
      if (replacement === null) return; // cancelled
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
        } else if (r.status === 403) {
          setStatus("403 — unlock first or bad token.", false);
        } else {
          setStatus("Error: " + r.status, false);
        }
      });
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
    loadThreadList();
  </script>
</body>
</html>
`;
