const res = await fetch("http://localhost:3000/file/costa-norte");
const contentType = res.headers.get("content-type");
console.log("Content-Type:", contentType);
const buf = Buffer.from(await res.arrayBuffer());
const html = buf.toString("utf8");

function hexAround(label, needle) {
  const idx = html.indexOf(needle);
  if (idx < 0) {
    console.log(`${label}: not found`);
    return;
  }
  const start = Math.max(0, idx - 6);
  const end = Math.min(buf.length, idx + needle.length + 6);
  const slice = buf.subarray(start, end);
  console.log(`${label}: bytes [${[...slice].join(" ")}] text=${JSON.stringify(slice.toString("utf8"))}`);
}

hexAround("story 'cuál'", "cuál");
hexAround("finding 'emisión'", "emisión");
hexAround("title middot", "vista de ficha");
hexAround("file-meta middot", "6/10/2026");

const c2 = (html.match(/Â/g) || []).length;
const middot = (html.match(/·/g) || []).length;
console.log("U+00C2 (Â):", c2, " U+00B7 (·):", middot);
