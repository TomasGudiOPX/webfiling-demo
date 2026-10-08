import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("data/webfiling.sqlite");
const row = db.prepare("SELECT preview_title FROM files WHERE id='costa-plan-current'").get();
const t = row.preview_title;
console.log("title:", JSON.stringify(t));
console.log("codepoints:", [...t].map((c) => c.codePointAt(0)).join(" "));
