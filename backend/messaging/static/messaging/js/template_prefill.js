(function () {
  "use strict";

  let defaults = null;

  function getDefaultsUrl() {
    var path = window.location.pathname;
    var match = path.match(/(\/[\w-]*\/admin\/messaging\/template\/)/);
    if (match) {
      return match[1] + "template-defaults/";
    }
    return null;
  }

  function prefillFields(eventType) {
    if (!defaults || !defaults[eventType]) return;

    var data = defaults[eventType];

    // For each key in the defaults data, find matching field by id
    Object.keys(data).forEach(function (key) {
      var value = data[key];
      if (!value) return;

      // Match field by id: id_<key>
      var field = document.getElementById("id_" + key);
      if (field) {
        field.value = value;
        field.dispatchEvent(new Event("change"));
      }
    });
  }

  function init() {
    var eventTypeSelect = document.getElementById("id_event_type");
    if (!eventTypeSelect) return;

    var url = getDefaultsUrl();
    if (!url) return;

    fetch(url, { credentials: "same-origin" })
      .then(function (response) { return response.json(); })
      .then(function (data) {
        defaults = data;
      });

    eventTypeSelect.addEventListener("change", function () {
      if (this.value) {
        prefillFields(this.value);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
