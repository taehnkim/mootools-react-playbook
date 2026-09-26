(function (global) {
  global["mountTabPane"] = function (container, options, initialIndex) {
    var featureFlagger = global["featureFlagger"];
    if (!featureFlagger) {
      return new global["TabPane"](container, options, initialIndex);
    }
    var implementation = featureFlagger.get("TabPane");
    if (implementation === "legacy-TabPane") {
      return new global["TabPane"](container, options, initialIndex);
    }
    if (implementation === "react-TabPane") {
      var reactMount = global["mountReactTabPane"];
      if (typeof reactMount !== "function") {
        throw new Error("React mount global mountReactTabPane is not available.");
      }
      return reactMount(container, options, initialIndex);
    }
    throw new Error("Feature flagger returned an unsupported implementation for TabPane: " + String(implementation) + ".");
  };
})(window);
