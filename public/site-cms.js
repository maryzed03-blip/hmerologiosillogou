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


  function stripHtml(value) {
    var holder = document.createElement("div");
    holder.innerHTML = String(value || "");
    return String(holder.textContent || holder.innerText || "").replace(/\s+/g, " ").trim();
  }

  function shortText(value, maxLength) {
    var text = stripHtml(value);
    var limit = Math.max(40, Number(maxLength) || 150);
    return text.length > limit ? text.slice(0, limit - 1).trim() + "…" : text;
  }

  function greekDate(dateString) {
    if (!dateString) return "";
    try {
      var date = new Date(String(dateString) + "T12:00:00");
      return new Intl.DateTimeFormat("el-GR", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric"
      }).format(date);
    } catch (error) {
      return String(dateString);
    }
  }

  function activityTypeLabel(eventItem) {
    if (eventItem.event_type) return eventItem.event_type;
    if (eventItem.activity_category === "association_free") return "Δωρεάν δράση";
    if (eventItem.activity_category === "therapist_action") return "Δράση θεραπευτή";
    return "Δράση Συλλόγου";
  }

  function buildActivityCard(eventItem) {
    var article = document.createElement("article");
    article.className = "sepsyg-activity-card";

    var imageWrap = document.createElement("div");
    imageWrap.className = "sepsyg-activity-image";
    var image = document.createElement("img");
    image.src = eventItem.image_url || "https://hmerologiosillogou.vercel.app/logo.png";
    image.alt = eventItem.topic || "Δράση Συλλόγου";
    image.loading = "lazy";
    imageWrap.appendChild(image);

    var type = document.createElement("span");
    type.className = "sepsyg-activity-type";
    type.textContent = activityTypeLabel(eventItem);
    imageWrap.appendChild(type);
    article.appendChild(imageWrap);

    var content = document.createElement("div");
    content.className = "sepsyg-activity-content";

    var mode = document.createElement("span");
    mode.className = "sepsyg-activity-mode";
    mode.textContent = eventItem.mode || eventItem.location || "Νέα δράση";
    content.appendChild(mode);

    var title = document.createElement("h3");
    title.className = "sepsyg-activity-title";
    title.textContent = eventItem.topic || "Δράση Συλλόγου";
    content.appendChild(title);

    var subtitle = document.createElement("p");
    subtitle.className = "sepsyg-activity-subtitle";
    subtitle.textContent = shortText(eventItem.description || eventItem.long_description || "", 155);
    if (subtitle.textContent) content.appendChild(subtitle);

    var meta = document.createElement("div");
    meta.className = "sepsyg-activity-meta";
    var date = document.createElement("span");
    date.textContent = greekDate(eventItem.booking_date);
    meta.appendChild(date);
    if (eventItem.action_time) {
      var time = document.createElement("span");
      time.textContent = eventItem.action_time;
      meta.appendChild(time);
    }
    if (eventItem.location) {
      var location = document.createElement("span");
      location.textContent = "📍 " + eventItem.location;
      meta.appendChild(location);
    }
    content.appendChild(meta);

    var button = document.createElement("a");
    button.className = "sepsyg-activity-button";
    button.href = "https://hmerologiosillogou.vercel.app/events?event=" + encodeURIComponent(eventItem.booking_date || eventItem.id || "");
    button.target = "_blank";
    button.rel = "noopener noreferrer";
    button.textContent = "Δείτε περισσότερα";
    content.appendChild(button);

    article.appendChild(content);
    return article;
  }

  function loadLatestActivities(root) {
    var grid = root && root.querySelector(".sepsyg-activities-grid");
    if (!grid || grid.dataset.dynamicLoading === "1") return;
    grid.dataset.dynamicLoading = "1";

    fetch("https://hmerologiosillogou.vercel.app/api/public-events?limit=3&_=" + Date.now(), { cache: "no-store" })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (payload) {
        var items = payload && Array.isArray(payload.events) ? payload.events : [];
        if (!items.length) return;
        while (grid.firstChild) grid.removeChild(grid.firstChild);
        items.forEach(function (item) { grid.appendChild(buildActivityCard(item)); });

        var allButton = root.querySelector(".sepsyg-activities-all-button");
        if (allButton) {
          allButton.href = "https://hmerologiosillogou.vercel.app/events";
          allButton.target = "_blank";
          allButton.rel = "noopener noreferrer";
          allButton.textContent = "Δες όλες τις δράσεις";
        }
      })
      .catch(function () {
        /* Keep the existing Carrd fallback cards if the live feed is unavailable. */
      })
      .finally(function () { grid.dataset.dynamicLoading = "0"; });
  }

  function installCarrdScrollBridge() {
    if (window.__SEPSYG_CARRD_SCROLL_BRIDGE_V75__) return;
    window.__SEPSYG_CARRD_SCROLL_BRIDGE_V75__ = true;

    window.addEventListener("message", function (event) {
      var data = event && event.data;
      if (!data || data.type !== "SEPSYG_SCROLL_TO_EMBED_TOP") return;

      var frames = document.querySelectorAll("iframe");
      var sourceFrame = null;
      for (var i = 0; i < frames.length; i += 1) {
        if (frames[i].contentWindow === event.source) {
          sourceFrame = frames[i];
          break;
        }
      }
      if (!sourceFrame) return;

      var menu = document.querySelector("#sepsyg-menu-v3");
      var menuHeight = menu ? Math.ceil(menu.getBoundingClientRect().height) : 0;
      var top = window.pageYOffset + sourceFrame.getBoundingClientRect().top - menuHeight - 12;
      var behavior = data.behavior === "smooth" ? "smooth" : "auto";
      window.scrollTo({ top: Math.max(0, top), behavior: behavior });
    });
  }

  installCarrdScrollBridge();

  function applySpecial(config, root, fields, general) {
    if (config.section === "hero") {
      var bg = fields.background_image;
      var main = root.querySelector(".syg16-main");
      if (main && bg) main.style.setProperty("--cms-hero-image", 'url("' + String(bg).replace(/"/g, '\\"') + '")');

      /* V7.3 — Newsletter popup instead of inline hero box. */
      var oldInline = root.querySelector(".sepsyg-newsletter-cms");
      if (oldInline && oldInline.parentNode) oldInline.parentNode.removeChild(oldInline);

      var styleId = "sepsyg-newsletter-popup-style-v73";
      if (!document.getElementById(styleId)) {
        var style = document.createElement("style");
        style.id = styleId;
        style.textContent = [
          '#sepsyg-newsletter-popup-v73,#sepsyg-newsletter-popup-v73 *{box-sizing:border-box}',
          '#sepsyg-newsletter-popup-v73{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:22px;background:rgba(9,42,41,.58);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);opacity:0;visibility:hidden;transition:opacity .22s ease,visibility .22s ease;font-family:Arial,Helvetica,sans-serif}',
          '#sepsyg-newsletter-popup-v73.is-open{opacity:1;visibility:visible}',
          '#sepsyg-newsletter-popup-v73 .snp-card{position:relative;width:min(540px,100%);overflow:hidden;border:1px solid rgba(23,75,73,.14);border-radius:20px;background:#FFF9F3;box-shadow:0 30px 85px rgba(4,35,34,.30);transform:translateY(12px) scale(.985);transition:transform .22s ease}',
          '#sepsyg-newsletter-popup-v73.is-open .snp-card{transform:translateY(0) scale(1)}',
          '#sepsyg-newsletter-popup-v73 .snp-accent{height:7px;background:linear-gradient(90deg,var(--snp-teal,#008D8B),var(--snp-peach,#E1AF85))}',
          '#sepsyg-newsletter-popup-v73 .snp-inner{padding:34px 34px 30px}',
          '#sepsyg-newsletter-popup-v73 .snp-close{position:absolute;top:18px;right:18px;width:36px;height:36px;border:1px solid rgba(23,75,73,.12);border-radius:50%;background:#fff;color:#174B49;font-size:21px;line-height:1;cursor:pointer;display:grid;place-items:center}',
          '#sepsyg-newsletter-popup-v73 .snp-close:hover{background:#F4ECE5}',
          '#sepsyg-newsletter-popup-v73 .snp-eyebrow{display:block;margin:0 46px 10px 0;color:#008D8B;font-size:.69rem;font-weight:800;letter-spacing:.17em;text-transform:uppercase}',
          '#sepsyg-newsletter-popup-v73 h2{margin:0;color:#174B49;font:500 clamp(1.85rem,5vw,2.45rem)/1.08 Georgia,"Times New Roman",serif;letter-spacing:-.02em}',
          '#sepsyg-newsletter-popup-v73 .snp-text{margin:15px 0 22px;color:#627472;font-size:.95rem;line-height:1.68}',
          '#sepsyg-newsletter-popup-v73 .snp-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:9px}',
          '#sepsyg-newsletter-popup-v73 .snp-row input{width:100%;min-width:0;height:48px;border:1px solid rgba(23,75,73,.20);border-radius:10px;background:#fff;color:#263B39;padding:0 14px;font:inherit;font-size:.92rem;outline:none}',
          '#sepsyg-newsletter-popup-v73 .snp-row input:focus{border-color:#008D8B;box-shadow:0 0 0 3px rgba(0,141,139,.10)}',
          '#sepsyg-newsletter-popup-v73 .snp-submit{height:48px;border:0;border-radius:10px;padding:0 20px;background:var(--snp-peach,#E1AF85);color:#174B49;font-size:.86rem;font-weight:800;cursor:pointer;white-space:nowrap}',
          '#sepsyg-newsletter-popup-v73 .snp-submit:hover{filter:brightness(.97)}',
          '#sepsyg-newsletter-popup-v73 .snp-submit:disabled{opacity:.65;cursor:wait}',
          '#sepsyg-newsletter-popup-v73 .snp-consent{display:grid;grid-template-columns:18px 1fr;gap:9px;align-items:start;margin-top:13px;color:#71817E;font-size:.72rem;line-height:1.48;text-align:left}',
          '#sepsyg-newsletter-popup-v73 .snp-consent input{width:16px;height:16px;margin:2px 0 0;accent-color:#008D8B}',
          '#sepsyg-newsletter-popup-v73 .snp-status{min-height:20px;margin-top:10px;color:#174B49;font-size:.76rem;line-height:1.45}',
          '#sepsyg-newsletter-popup-v73 .snp-later{display:block;margin:11px auto 0;border:0;background:transparent;color:#71817E;font-size:.76rem;text-decoration:underline;text-underline-offset:3px;cursor:pointer}',
          '#sepsyg-newsletter-popup-v73 .snp-success{display:none;padding:14px 0 3px;color:#174B49;font-weight:700;text-align:center}',
          '#sepsyg-newsletter-popup-v73.is-success form,#sepsyg-newsletter-popup-v73.is-success .snp-text{display:none}',
          '#sepsyg-newsletter-popup-v73.is-success .snp-success{display:block}',
          '@media(max-width:560px){#sepsyg-newsletter-popup-v73{padding:16px}#sepsyg-newsletter-popup-v73 .snp-inner{padding:30px 22px 24px}#sepsyg-newsletter-popup-v73 .snp-row{grid-template-columns:1fr}#sepsyg-newsletter-popup-v73 .snp-submit{width:100%}}'
        ].join('');
        document.head.appendChild(style);
      }

      var popup = document.getElementById("sepsyg-newsletter-popup-v73");
      if (!popup) {
        popup = document.createElement("div");
        popup.id = "sepsyg-newsletter-popup-v73";
        popup.setAttribute("role", "dialog");
        popup.setAttribute("aria-modal", "true");
        popup.setAttribute("aria-labelledby", "sepsyg-newsletter-popup-title-v73");
        popup.innerHTML =
          '<div class="snp-card">' +
            '<div class="snp-accent" aria-hidden="true"></div>' +
            '<button type="button" class="snp-close" aria-label="Κλείσιμο">×</button>' +
            '<div class="snp-inner">' +
              '<span class="snp-eyebrow"></span>' +
              '<h2 id="sepsyg-newsletter-popup-title-v73"></h2>' +
              '<p class="snp-text"></p>' +
              '<form novalidate>' +
                '<div class="snp-row"><input type="email" autocomplete="email" required><button class="snp-submit" type="submit"></button></div>' +
                '<label class="snp-consent"><input type="checkbox" required><span></span></label>' +
                '<div class="snp-status" role="status" aria-live="polite"></div>' +
                '<button type="button" class="snp-later">Όχι τώρα</button>' +
              '</form>' +
              '<div class="snp-success">✓ Η εγγραφή ολοκληρώθηκε. Ευχαριστούμε!</div>' +
            '</div>' +
          '</div>';
        document.body.appendChild(popup);

        var closePopup = function () {
          popup.classList.remove("is-open");
          try { sessionStorage.setItem("sepsyg_newsletter_popup_dismissed", "1"); } catch (error) {}
          setTimeout(function () { popup.setAttribute("aria-hidden", "true"); }, 240);
        };
        popup.querySelector(".snp-close").addEventListener("click", closePopup);
        popup.querySelector(".snp-later").addEventListener("click", closePopup);

        /* Clicking the dark backdrop intentionally does NOT close the popup. */
        popup.addEventListener("mousedown", function (event) {
          if (event.target === popup) event.preventDefault();
        });

        var form = popup.querySelector("form");
        form.addEventListener("submit", function (event) {
          event.preventDefault();
          var emailInput = popup.querySelector('input[type="email"]');
          var consentInput = popup.querySelector('input[type="checkbox"]');
          var submit = popup.querySelector(".snp-submit");
          var status = popup.querySelector(".snp-status");
          var email = String(emailInput.value || "").trim();
          var consent = !!consentInput.checked;

          if (!email) {
            status.textContent = "Γράψε το email σου.";
            emailInput.focus();
            return;
          }
          if (!consent) {
            status.textContent = "Χρειάζεται να επιλέξεις τη συγκατάθεση για την ενημέρωση.";
            consentInput.focus();
            return;
          }

          submit.disabled = true;
          status.textContent = "Γίνεται η εγγραφή…";
          fetch("https://hmerologiosillogou.vercel.app/api/newsletter-signup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: email, consent: true, source: "carrd-popup" })
          }).then(function (response) {
            return response.json().catch(function () { return {}; }).then(function (payload) {
              if (!response.ok) throw new Error(payload.code || "NEWSLETTER_FAILED");
              return payload;
            });
          }).then(function (payload) {
            try {
              localStorage.setItem("sepsyg_newsletter_subscribed", "1");
              sessionStorage.removeItem("sepsyg_newsletter_popup_dismissed");
            } catch (error) {}
            popup.classList.add("is-success");
            var success = popup.querySelector(".snp-success");
            success.textContent = payload.alreadySubscribed
              ? "✓ Είσαι ήδη στη λίστα ενημέρωσης."
              : "✓ Η εγγραφή ολοκληρώθηκε. Ευχαριστούμε!";
            setTimeout(function () {
              popup.classList.remove("is-open");
              popup.setAttribute("aria-hidden", "true");
            }, 1500);
          }).catch(function () {
            status.textContent = "Δεν ολοκληρώθηκε η εγγραφή. Δοκίμασε ξανά.";
            submit.disabled = false;
          });
        });
      }

      if (popup) {
        popup.style.setProperty("--snp-teal", fields.style_section_background || "#008D8B");
        popup.style.setProperty("--snp-peach", fields.style_accent_color || "#E1AF85");
        var set = function (selector, value, fallback) {
          var node = popup.querySelector(selector);
          if (node) node.textContent = value || fallback || "";
        };
        set(".snp-eyebrow", fields.newsletter_eyebrow, "Newsletter");
        set("h2", fields.newsletter_title, "Μείνε κοντά στις δράσεις μας");
        set(".snp-text", fields.newsletter_text, "Εγγράψου στο newsletter μας για να ενημερώνεσαι για νέες δράσεις, σεμινάρια και ανακοινώσεις του Συλλόγου.");
        set(".snp-consent span", fields.newsletter_consent, "Συμφωνώ να λαμβάνω ενημερώσεις μέσω email από τον Σύλλογο.");
        var input = popup.querySelector('input[type="email"]');
        if (input) input.placeholder = fields.newsletter_placeholder || "Το email σου";
        var button = popup.querySelector(".snp-submit");
        if (button) button.textContent = fields.newsletter_button || "Εγγραφή";

        var subscribed = false;
        var dismissed = false;
        try {
          subscribed = localStorage.getItem("sepsyg_newsletter_subscribed") === "1";
          dismissed = sessionStorage.getItem("sepsyg_newsletter_popup_dismissed") === "1";
        } catch (error) {}

        if (!subscribed && !dismissed && !popup.dataset.scheduled) {
          popup.dataset.scheduled = "1";
          setTimeout(function () {
            popup.removeAttribute("aria-hidden");
            popup.classList.add("is-open");
            var emailField = popup.querySelector('input[type="email"]');
            setTimeout(function () { if (emailField) emailField.focus(); }, 260);
          }, 650);
        }
      }
    }

    if (config.section === "activities_static") {
      loadLatestActivities(root);
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