(function () {
  "use strict";

  var API = "https://hmerologiosillogou.vercel.app/api/site-content";

  function cleanText(value) {
    return typeof value === "string" ? value : "";
  }

  function getNode(root, item) {
    if (!root || !item || !item.selector) return null;
    var nodes = root.querySelectorAll(item.selector);
    return nodes[Math.max(0, Number(item.index) || 0)] || null;
  }

  function setLeadingText(node, value) {
    if (!node) return;
    var textNode = null;
    for (var i = 0; i < node.childNodes.length; i += 1) {
      if (node.childNodes[i].nodeType === 3 && String(node.childNodes[i].nodeValue || "").trim()) {
        textNode = node.childNodes[i];
        break;
      }
    }
    if (textNode) {
      textNode.nodeValue = value + " ";
    } else {
      node.insertBefore(document.createTextNode(value + " "), node.firstChild || null);
    }
  }

  function setMultiline(node, value) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
    String(value || "").split(/\r?\n/).forEach(function (line, index) {
      if (index) node.appendChild(document.createElement("br"));
      node.appendChild(document.createTextNode(line));
    });
  }

  function normalizePhone(value) {
    var digits = String(value || "").replace(/\D+/g, "");
    if (digits.indexOf("30") === 0) return "+" + digits;
    return digits ? "+30" + digits : "";
  }

  function transformed(value, transform) {
    if (transform === "mailto") return value ? "mailto:" + value : "";
    if (transform === "tel") return value ? "tel:" + normalizePhone(value) : "";
    if (transform === "formsubmit") return value ? "https://formsubmit.co/" + value : "";
    return value;
  }

  function applyMapping(root, fields, item) {
    if (!Object.prototype.hasOwnProperty.call(fields, item.key)) return;
    var node = getNode(root, item);
    if (!node) return;
    var value = cleanText(fields[item.key]);

    if (item.attr) {
      node.setAttribute(item.attr, transformed(value, item.transform));
      return;
    }

    if (item.mode === "leading") {
      setLeadingText(node, value);
      return;
    }
    if (item.mode === "multiline") {
      setMultiline(node, value);
      return;
    }
    node.textContent = value;
  }

  function applyGeneral(root, general, mappings) {
    (mappings || []).forEach(function (item) {
      if (!Object.prototype.hasOwnProperty.call(general, item.key)) return;
      var node = getNode(root, item);
      if (!node) return;
      var value = cleanText(general[item.key]);
      if (item.attr) {
        node.setAttribute(item.attr, transformed(value, item.transform));
      } else if (item.mode === "leading") {
        setLeadingText(node, value);
      } else if (item.mode === "multiline") {
        setMultiline(node, value);
      } else {
        node.textContent = value;
      }
    });
  }

  function applyStyleVars(root, fields) {
    Object.keys(fields || {}).forEach(function (key) {
      if (key.indexOf("style_") !== 0) return;
      var cssName = "--cms-" + key.slice(6).replace(/_/g, "-");
      root.style.setProperty(cssName, fields[key]);
    });
  }

  function applySpecial(config, root, fields, general) {
    if (config.section === "hero") {
      var bg = fields.background_image;
      var main = root.querySelector(".syg16-main");
      if (main && bg) main.style.setProperty("--cms-hero-image", 'url("' + String(bg).replace(/"/g, '\\"') + '")');

      var host = root.querySelector(".syg16-main");
      if (host && !root.querySelector(".sepsyg-newsletter-cms")) {
        var wrap = document.createElement("div");
        wrap.className = "sepsyg-newsletter-cms";
        wrap.innerHTML =
          '<div class="sepsyg-newsletter-cms-copy">' +
            '<span class="sepsyg-newsletter-eyebrow"></span>' +
            '<strong class="sepsyg-newsletter-title"></strong>' +
            '<p class="sepsyg-newsletter-text"></p>' +
          '</div>' +
          '<form class="sepsyg-newsletter-cms-form">' +
            '<div class="sepsyg-newsletter-cms-row"><input type="email" required autocomplete="email"><button type="submit"></button></div>' +
            '<label><input type="checkbox" required><span class="sepsyg-newsletter-consent"></span></label>' +
            '<div class="sepsyg-newsletter-status" role="status" aria-live="polite"></div>' +
          '</form>';
        host.appendChild(wrap);

        var form = wrap.querySelector("form");
        form.addEventListener("submit", function (event) {
          event.preventDefault();
          var email = String(wrap.querySelector('input[type="email"]').value || "").trim();
          var consent = !!wrap.querySelector('input[type="checkbox"]').checked;
          var status = wrap.querySelector(".sepsyg-newsletter-status");
          if (!email || !consent) {
            status.textContent = "Συμπλήρωσε το email και τη συγκατάθεση.";
            return;
          }
          status.textContent = "Αποστολή…";
          fetch("https://hmerologiosillogou.vercel.app/api/newsletter-signup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: email, consent: consent, source: "carrd-hero" })
          }).then(function (response) {
            return response.json().catch(function () { return {}; }).then(function (payload) {
              if (!response.ok) throw new Error(payload.code || "NEWSLETTER_FAILED");
              return payload;
            });
          }).then(function (payload) {
            status.textContent = payload.alreadySubscribed ? "Είσαι ήδη στη λίστα ενημέρωσης." : "Η εγγραφή ολοκληρώθηκε. Ευχαριστούμε!";
            if (!payload.alreadySubscribed) form.reset();
          }).catch(function () {
            status.textContent = "Δεν ολοκληρώθηκε η εγγραφή. Δοκίμασε ξανά.";
          });
        });
      }

      var newsletter = root.querySelector(".sepsyg-newsletter-cms");
      if (newsletter) {
        var set = function (selector, value) {
          var node = newsletter.querySelector(selector);
          if (node) node.textContent = value || "";
        };
        set(".sepsyg-newsletter-eyebrow", fields.newsletter_eyebrow);
        set(".sepsyg-newsletter-title", fields.newsletter_title);
        set(".sepsyg-newsletter-text", fields.newsletter_text);
        set(".sepsyg-newsletter-consent", fields.newsletter_consent);
        var input = newsletter.querySelector('input[type="email"]');
        if (input) input.placeholder = fields.newsletter_placeholder || "Το email σου";
        var button = newsletter.querySelector("button");
        if (button) button.textContent = fields.newsletter_button || "Εγγραφή";
      }
    }
  }

  function fetchSection(section) {
    return fetch(API + "?section=" + encodeURIComponent(section) + "&_=" + Date.now(), { cache: "no-store" })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (payload) { return payload && payload.section && payload.section.fields ? payload.section.fields : {}; })
      .catch(function () { return {}; });
  }

  function bind(config) {
    var root = document.querySelector(config.root);
    if (!root) return;

    Promise.all([fetchSection(config.section), fetchSection("general")]).then(function (results) {
      var fields = results[0] || {};
      var general = results[1] || {};
      (config.mappings || []).forEach(function (item) { applyMapping(root, fields, item); });
      applyGeneral(root, general, config.generalMappings || []);
      applyStyleVars(root, fields);
      applySpecial(config, root, fields, general);

      window.dispatchEvent(new CustomEvent("SEPSYG_CMS_APPLIED", {
        detail: { section: config.section, fields: fields, general: general }
      }));
    });
  }

  window.SEPSYGCMS = { bind: bind };
})();