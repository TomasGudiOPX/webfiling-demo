import {
  DISCIPLINE_TAGS,
  DOCUMENT_CATEGORIES,
  LOCATION_TAGS,
  type DocumentCategoryId,
  type DisciplineTagId,
  type FileStatus,
  type LocationTagId,
} from "./types";

export const FILE_STATUSES: readonly FileStatus[] = [
  "approved",
  "pending_review",
  "pending_ingestion",
  "superseded",
  "returned",
  "missing_metadata",
];
export const DOCUMENT_TYPE_IDS = [
  "plan",
  "notice",
  "other",
  "technical",
  "contract",
  "log",
  "specification",
  "financial",
  "logistics",
  "hse",
  "procurement",
] as const;
export type DocumentTypeId = (typeof DOCUMENT_TYPE_IDS)[number];
export type WorkspaceScope = "project" | "all";
export type SearchTimeframe = "" | "7d" | "30d" | "90d" | "year";
export type SearchSort = "recent" | "oldest" | "name";
export type CategoryFilter = "" | "unclassified" | DocumentCategoryId;

export interface SearchFilters {
  query: string;
  scope: WorkspaceScope;
  status: FileStatus | "";
  type: DocumentTypeId | "";
  timeframe: SearchTimeframe;
  sort: SearchSort;
  category: CategoryFilter;
  discipline: DisciplineTagId | "";
  location: LocationTagId | "";
}

export interface InvalidSearchFilter {
  key: string;
  value: string;
}

export interface ParsedSearchFilters {
  filters: SearchFilters;
  invalid: InvalidSearchFilter[];
}

export function workspaceUrl(
  projectSlug: string,
  filters: Partial<SearchFilters>,
  selectedId?: string,
): string {
  const params = new URLSearchParams();
  const entries: Array<[string, string | undefined]> = [
    ["q", filters.query],
    ["scope", filters.scope === "all" ? "all" : undefined],
    ["status", filters.status],
    ["type", filters.type],
    ["timeframe", filters.timeframe],
    ["sort", filters.sort === "recent" ? undefined : filters.sort],
    ["category", filters.category],
    ["discipline", filters.discipline],
    ["location", filters.location],
  ];
  for (const [key, value] of entries)
    if (value) params.set(key, value);
  if (selectedId) params.set("selected", selectedId);
  const search = params.toString();
  return `/file/${encodeURIComponent(projectSlug)}${search ? `?${search}` : ""}`;
}

const includes = (values: readonly string[], value: string): boolean =>
  values.includes(value);

export function parseSearchFilters(params: URLSearchParams): ParsedSearchFilters {
  const invalid: InvalidSearchFilter[] = [];
  const value = (key: string) => params.get(key) ?? "";
  const recover = (key: string, supported: readonly string[], fallback = "") => {
    const candidate = value(key);
    if (!candidate || includes(supported, candidate)) return candidate || fallback;
    invalid.push({ key, value: candidate });
    return fallback;
  };

  const categories = ["unclassified", ...DOCUMENT_CATEGORIES.map(({ id }) => id)];
  const category = recover("category", categories) as CategoryFilter;

  return {
    filters: {
      query: value("q").trim(),
      scope: recover("scope", ["project", "all"], "project") as WorkspaceScope,
      status: recover("status", FILE_STATUSES) as FileStatus | "",
      type: recover("type", DOCUMENT_TYPE_IDS) as DocumentTypeId | "",
      timeframe: recover("timeframe", ["7d", "30d", "90d", "year"]) as SearchTimeframe,
      sort: recover("sort", ["recent", "oldest", "name"], "recent") as SearchSort,
      category,
      discipline: recover(
        "discipline",
        Object.keys(DISCIPLINE_TAGS),
      ) as DisciplineTagId | "",
      location: recover("location", Object.keys(LOCATION_TAGS)) as LocationTagId | "",
    },
    invalid: invalid.filter((item) => item.key !== "" && item.value !== ""),
  };
}
