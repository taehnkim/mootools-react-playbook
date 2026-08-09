export type MockFeatureFlagger = {
  get(feature: string): string | undefined;
};

export function createMockFeatureFlagger(
  flags: Readonly<Record<string, string>>,
): MockFeatureFlagger {
  return {
    get(feature) {
      return flags[feature];
    },
  };
}
