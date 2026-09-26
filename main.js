(function () {
  var initialize = function () {
    var tabPaneStatus = document.id("tab-pane-status");
    var tabPaneContainer = document.id("tab-pane");
    var tabPane = mountTabPane(tabPaneContainer);

    tabPane.addEvent("change", function (index) {
      tabPaneStatus.set("text", "Showing tab " + (index + 1) + ".");
    });

    tabPaneContainer.addEvent(
      "click:relay([data-close-tab])",
      function (event, closeButton) {
        event.stop();

        var tabs = tabPaneContainer.getElements(".tab");
        if (tabs.length === 1) {
          tabPaneStatus.set("text", "Keep at least one tab open.");
          return;
        }

        tabPane.close(closeButton.getParent(".tab"));
      },
    );

    document.id("add-tab-form").addEvent("submit", function (event) {
      event.stop();

      var titleInput = document.id("new-tab-title");
      var contentInput = document.id("new-tab-content");
      var title = titleInput.get("value").trim();
      var content = contentInput.get("value").trim();

      if (!title || !content) {
        tabPaneStatus.set("text", "Enter both a tab name and tab content.");
        return;
      }

      var closeButton = new Element("button", {
        "aria-label": "Close " + title + " tab",
        class: "tab-close",
        "data-close-tab": "",
        text: "\u00d7",
        type: "button",
      });
      var tab = new Element("li", { class: "tab" }).adopt(
        new Element("span", { text: title }),
        closeButton,
      );
      var panel = new Element("section", { class: "content" }).adopt(
        new Element("h3", { text: title }),
        new Element("p", { text: content }),
      );

      tabPane.add(tab, panel, null, true);
      titleInput.set("value", "");
      contentInput.set("value", "");
      titleInput.focus();
    });

    var brandBoxRunning = true;
    var brandBoxStatus = document.id("brand-box-status");
    var brandBox = new BrandBox("brand-box", {
      interval: 4000,
      list: "brand-box-list",
      tabs: "brand-box-tabs",
    });

    var renderBrandBoxStatus = function (index) {
      var state = brandBoxRunning ? "running" : "paused";
      brandBoxStatus.set(
        "text",
        "Showing item " + (index + 1) + ". Rotation is " + state + ".",
      );
    };

    brandBox.addEvent("change", function (index) {
      renderBrandBoxStatus(index);
    });

    document.id("brand-previous").addEvent("click", function () {
      brandBox.previous();
    });

    document.id("brand-next").addEvent("click", function () {
      brandBox.next();
    });

    document.id("brand-pause").addEvent("click", function () {
      if (brandBoxRunning) {
        brandBoxRunning = false;
        brandBox.stop();
        renderBrandBoxStatus(brandBox.current);
      }
    });

    document.id("brand-resume").addEvent("click", function () {
      if (!brandBoxRunning) {
        brandBoxRunning = true;
        brandBox.start();
        renderBrandBoxStatus(brandBox.current);
      }
    });

    var colorRangeStatus = document.id("color-range-status");
    var colorRangeStart = document.id("range-start");
    var colorRangeEnd = document.id("range-end");
    var colorSwatches = $$("#color-range .color-swatch");

    var applyColorRange = function () {
      var from = colorRangeStart.get("value");
      var to = colorRangeEnd.get("value");

      new ColorRange(from, to, colorSwatches.length).apply(colorSwatches);
      colorRangeStatus.set(
        "text",
        "Applied " +
          colorSwatches.length +
          " steps from " +
          from +
          " to " +
          to +
          ".",
      );
    };

    colorRangeStart.addEvent("change", applyColorRange);
    colorRangeEnd.addEvent("change", applyColorRange);
    applyColorRange();

    window.MooSandbox = {
      applyColorRange: applyColorRange,
      brandBox: brandBox,
      tabPane: tabPane,
    };
  };

  if (document.readyState === "loading") {
    document.addEvent("domready", initialize);
  } else {
    initialize();
  }
})();
