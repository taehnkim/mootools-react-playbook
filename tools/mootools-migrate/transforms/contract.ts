export type TransformStatistics = Readonly<Record<string, number>>;

export type UnsupportedTransformReason = {
  message: string;
  line: number;
  column: number;
};

export type SourceTransformResult =
  | {
      kind: "changed";
      source: string;
      statistics: TransformStatistics;
    }
  | {
      kind: "unchanged";
      source: string;
      statistics: TransformStatistics;
    }
  | {
      kind: "unsupported";
      source: string;
      statistics: TransformStatistics;
      reasons: UnsupportedTransformReason[];
    };

export function sourceLocation(
  location:
    | {
        start?: {
          line: number;
          column: number;
        } | null;
      }
    | null
    | undefined,
): { line: number; column: number } {
  return {
    line: location?.start?.line ?? 1,
    column: (location?.start?.column ?? 0) + 1,
  };
}
