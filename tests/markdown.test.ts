import assert from "node:assert/strict";
import test from "node:test";
import { renderMarkdown } from "../app/components/markdown";

test("Markdown headings render valid heading markup", () => {
  assert.match(renderMarkdown("# Gremios"), /^<h1>Gremios<\/h1>$/);
});
