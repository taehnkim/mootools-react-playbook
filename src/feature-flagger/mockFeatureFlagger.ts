export type MockFeatureFlagger = {
  get(feature: string): string | undefined;
  set(feature: string, value: string): void;
};

export function createMockFeatureFlagger(
  initialFlags: Readonly<Record<string, string>> = {},
): MockFeatureFlagger {
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
