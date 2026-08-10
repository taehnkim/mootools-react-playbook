export function createMockFeatureFlagger(initialFlags = {}) {
  const flags = new Map(Object.entries(initialFlags));

  return {
    get(feature) {
      return flags.get(feature);
    },
    set(feature, value) {
      flags.set(feature, value);
    },
  };
}
