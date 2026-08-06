(function () {
  "use strict";

  var root = document.getElementById("bayesian-ab-test");
  if (!root) return;

  var apiBaseUrl = (root.dataset.apiBaseUrl || "").replace(/\/$/, "");
  var productId = root.dataset.productId;
  var shopDomain = root.dataset.shopDomain;
  if (!apiBaseUrl || !productId || !shopDomain) return;

  var assignmentCookiePrefix = "bayesian_variant_";
  var sessionCookieName = "bayesian_session_id";
  var assignment;
  var impressionPromise = Promise.resolve();

  function cookieValue(name) {
    var prefix = name + "=";
    var cookie = document.cookie.split(";").map(function (part) {
      return part.trim();
    }).find(function (part) {
      return part.indexOf(prefix) === 0;
    });
    return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : null;
  }

  function setCookie(name, value, maxAgeSeconds) {
    document.cookie = name + "=" + encodeURIComponent(value) +
      "; Max-Age=" + maxAgeSeconds + "; Path=/; SameSite=Lax";
  }

  function sessionId() {
    var existing = cookieValue(sessionCookieName);
    if (existing) return existing;
    var id = window.crypto && window.crypto.randomUUID
      ? window.crypto.randomUUID()
      : "session-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    setCookie(sessionCookieName, id, 60 * 60 * 24 * 365);
    return id;
  }

  function sendEvent(type) {
    if (!assignment) return Promise.resolve();
    var visitorSessionId = sessionId();
    return fetch(apiBaseUrl + "/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        experimentId: assignment.experimentId,
        variantId: assignment.variant.id,
        sessionId: visitorSessionId,
        type: type,
        idempotencyKey: "theme:" + assignment.experimentId + ":" +
          assignment.variant.id + ":" + visitorSessionId + ":" + type
      }),
      keepalive: true
    }).then(function (response) {
      if (!response.ok) throw new Error("Event request failed: " + response.status);
    }).catch(function (error) {
      console.warn("Bayesian A/B test event was not recorded", error);
    });
  }

  function applyConfig(config) {
    if (!config || typeof config !== "object") return;

    if (config.ctaText) {
      document.querySelectorAll(
        'button[name="add"], button[type="submit"][name="add"], .product-form__submit'
      ).forEach(function (button) {
        button.textContent = String(config.ctaText);
      });
    }

    if (config.price !== undefined && config.price !== null) {
      document.querySelectorAll(
        '[data-product-price], .price-item--regular, .product__price, .price'
      ).forEach(function (priceElement) {
        priceElement.textContent = String(config.price);
      });
    }
  }

  function recordImpressionOnce() {
    var key = "bayesian_impression_" + assignment.experimentId;
    if (window.sessionStorage.getItem(key)) return Promise.resolve();
    window.sessionStorage.setItem(key, "1");
    return sendEvent("impression");
  }

  function recordConversionOnce() {
    var key = "bayesian_conversion_" + assignment.experimentId;
    if (window.sessionStorage.getItem(key)) return;
    window.sessionStorage.setItem(key, "1");
    impressionPromise.then(function () {
      return sendEvent("conversion");
    });
  }

  function attachConversionListener() {
    document.addEventListener("click", function (event) {
      var target = event.target;
      var button = target && target.closest
        ? target.closest('button[name="add"], button[type="submit"][name="add"], .product-form__submit')
        : null;
      if (button) recordConversionOnce();
    }, true);
  }

  fetch(apiBaseUrl + "/api/experiments/active?productId=" +
    encodeURIComponent(productId) + "&shop=" + encodeURIComponent(shopDomain), {
      headers: { Accept: "application/json" }
    })
    .then(function (response) {
      if (!response.ok) throw new Error("Active experiment request failed: " + response.status);
      return response.json();
    })
    .then(function (data) {
      if (!data.experiment || !data.experiment.variants || data.experiment.variants.length !== 2) return;

      var experiment = data.experiment;
      var cookieName = assignmentCookiePrefix + experiment.id;
      var savedVariantId = cookieValue(cookieName);
      var variant = experiment.variants.find(function (candidate) {
        return candidate.id === savedVariantId;
      });
      if (!variant) {
        variant = experiment.variants[Math.random() < 0.5 ? 0 : 1];
        setCookie(cookieName, variant.id, 60 * 60 * 24 * 30);
      }

      assignment = { experimentId: experiment.id, variant: variant };
      applyConfig(variant.config);
      impressionPromise = recordImpressionOnce();
      attachConversionListener();
      root.hidden = false;
    })
    .catch(function (error) {
      console.warn("Bayesian A/B test could not initialize", error);
    });
})();
