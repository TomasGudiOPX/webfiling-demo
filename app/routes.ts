import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/home.ts"),
  route("file", "routes/file._index.tsx"),
  route("file/:projectSlug", "routes/file.$projectSlug.tsx"),
  route("file/:projectSlug/search", "routes/file.$projectSlug.search.tsx"),
  route("api/health", "routes/api.health.ts"),
  route("api/projects", "routes/api.projects.ts"),
  route(
    "api/projects/:projectId/files",
    "routes/api.projects.$projectId.files.ts",
  ),
  route(
    "api/projects/:projectId/as-of",
    "routes/api.projects.$projectId.as-of.ts",
  ),
  route("api/files/:fileId", "routes/api.files.$fileId.ts"),
  route("api/files/:fileId/preview", "routes/api.files.$fileId.preview.ts"),
  route("api/files/:fileId/review", "routes/api.files.$fileId.review.ts"),
  route("api/files/:fileId/activity", "routes/api.files.$fileId.activity.ts"),
  route("api/reviews", "routes/api.reviews.ts"),
  route("api/reviews/:reviewItemId", "routes/api.reviews.$reviewItemId.ts"),
  route(
    "api/reviews/:reviewItemId/decision",
    "routes/api.reviews.$reviewItemId.decision.ts",
  ),
  route("file/review", "routes/file.review.tsx"),
  route("api/search", "routes/api.search.ts"),
  route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
