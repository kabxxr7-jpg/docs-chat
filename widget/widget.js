/* docs-chat widget. One file, no dependencies. Everything from the server is inserted as
   plain text (textContent), never parsed as HTML.
   Usage: <script src="/widget.js"></script> then DocsChat.init({ endpoint: "/ask" }) */
(function () {
  "use strict";

  var panel, log, input, sendButton, toggle, endpoint;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function addMessage(kind, text, citations) {
    var box = el("div", "dc-msg dc-" + kind);
    box.appendChild(el("div", "dc-text", text));
    if (citations && citations.length) {
      var list = el("ul", "dc-sources");
      citations.forEach(function (c) {
        var item = el("li");
        item.appendChild(el("strong", "", String(c.file) + ": "));
        item.appendChild(document.createTextNode("“" + String(c.quote) + "”"));
        list.appendChild(item);
      });
      box.appendChild(list);
    }
    log.appendChild(box);
    log.scrollTop = log.scrollHeight;
    return box;
  }

  function send(question) {
    question = String(question || "").trim();
    if (!question) return Promise.resolve();
    open();
    addMessage("user", question);
    var pending = addMessage("bot", "Looking through the documents…");
    sendButton.disabled = true;
    return fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: question }),
    })
      .then(function (res) {
        return res.json().catch(function () { return { status: "error", message: "Unexpected reply." }; });
      })
      .then(function (data) {
        pending.remove();
        if (data.status === "answered") addMessage("bot", data.answer, data.citations);
        else addMessage("refused", data.message || "No answer.");
      })
      .catch(function () {
        pending.remove();
        addMessage("refused", "Could not reach the server.");
      })
      .then(function () {
        sendButton.disabled = false;
      });
  }

  function open() {
    panel.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
  }

  function init(options) {
    options = options || {};
    endpoint = options.endpoint || "/ask";

    var style = el("style");
    style.textContent =
      ".dc-toggle{position:fixed;right:20px;bottom:20px;z-index:2147483000;padding:12px 16px;border:0;border-radius:24px;background:#1f4e5f;color:#fff;font:600 14px system-ui,sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.25)}" +
      ".dc-panel{position:fixed;right:20px;bottom:76px;z-index:2147483000;width:min(360px,calc(100vw - 40px));height:min(480px,calc(100vh - 110px));display:flex;flex-direction:column;background:#fff;color:#1a1a1a;border:1px solid #cfd8dc;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.2);font:14px/1.4 system-ui,sans-serif}" +
      ".dc-panel[hidden]{display:none}" +
      ".dc-head{padding:10px 14px;border-bottom:1px solid #e3e8ea;font-weight:600}" +
      ".dc-log{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px}" +
      ".dc-msg{max-width:92%;padding:8px 10px;border-radius:10px;white-space:pre-wrap;overflow-wrap:anywhere}" +
      ".dc-user{align-self:flex-end;background:#1f4e5f;color:#fff}" +
      ".dc-bot{align-self:flex-start;background:#eef3f5}" +
      ".dc-refused{align-self:flex-start;background:#fff4e5;border:1px solid #f0cf9a}" +
      ".dc-sources{margin:6px 0 0;padding-left:16px;font-size:12px;color:#455a64}" +
      ".dc-form{display:flex;gap:6px;padding:10px;border-top:1px solid #e3e8ea}" +
      ".dc-form input{flex:1;padding:8px;border:1px solid #b0bec5;border-radius:8px;font:inherit}" +
      ".dc-form button{padding:8px 12px;border:0;border-radius:8px;background:#1f4e5f;color:#fff;font:inherit;cursor:pointer}" +
      ".dc-form button:disabled{opacity:.6;cursor:default}";
    document.head.appendChild(style);

    toggle = el("button", "dc-toggle", options.buttonLabel || "Ask the docs");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", "dc-panel");

    panel = el("div", "dc-panel");
    panel.id = "dc-panel";
    panel.hidden = true;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", options.title || "Ask the documents");
    panel.appendChild(el("div", "dc-head", options.title || "Ask the documents"));
    log = el("div", "dc-log");
    log.setAttribute("aria-live", "polite");
    panel.appendChild(log);

    var form = el("form", "dc-form");
    input = el("input");
    input.type = "text";
    input.maxLength = 500;
    input.placeholder = options.placeholder || "Ask a question";
    input.setAttribute("aria-label", "Your question");
    sendButton = el("button", "", "Ask");
    sendButton.type = "submit";
    form.appendChild(input);
    form.appendChild(sendButton);
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var q = input.value;
      input.value = "";
      send(q);
    });
    panel.appendChild(form);

    toggle.addEventListener("click", function () {
      if (panel.hidden) open();
      else {
        panel.hidden = true;
        toggle.setAttribute("aria-expanded", "false");
      }
    });

    document.body.appendChild(panel);
    document.body.appendChild(toggle);
  }

  window.DocsChat = { init: init, ask: send };
})();
