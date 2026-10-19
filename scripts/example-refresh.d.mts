export type ReviewedExample = {
  slug: string;
  renderId: string;
  workspace?: string;
};

export type RefreshOverride = {
  slug: string;
  renderId: string;
  workspace: string;
  sourceSha256: string;
  frameEditId?: string;
  imageGenerationId?: string;
};

export function applyReviewedRefresh<T extends ReviewedExample>(
  reviewedCases: T[],
  refresh?: unknown,
): Array<T & Partial<RefreshOverride>>;

export function validateRefreshBinding(
  item: ReviewedExample & { sourceSha256?: string },
  render: {
    id: string;
    state: string;
    output?: string | null;
    recipe?: { clip?: { sha256?: string } };
  },
  previousRecipe?: { clip?: { sha256?: string } },
): void;
