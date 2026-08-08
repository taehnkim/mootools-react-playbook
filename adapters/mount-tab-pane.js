(function (global) {
  global["mountTabPane"] = function (container, options, initialIndex) {
    var tableManager = global["tableManager"];
    if (tableManager && tableManager.isEnabled("react-tab-pane")) {
      var reactMount = global["mountReactTabPane"];
      if (typeof reactMount !== "function") {
        throw new Error("React mount global mountReactTabPane is not available.");
      }
      return reactMount(container, options, initialIndex);
    }
    return new global["TabPane"](container, options, initialIndex);
  };
})(window);
