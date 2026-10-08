import fs from "node:fs";

const file = "app/scenarios.ts";
const buf = fs.readFileSync(file);
let out = "";
let i = 0;
let fixed = 0;

while (i < buf.length) {
  const b = buf[i];
  if (b < 0x80) {
    out += String.fromCharCode(b);
    i++;
    continue;
  }
  if (b >= 0xc2 && b <= 0xdf && i + 1 < buf.length && buf[i + 1] >= 0x80 && buf[i + 1] <= 0xbf) {
    out += String.fromCharCode(((b & 0x1f) << 6) | (buf[i + 1] & 0x3f));
    i += 2;
    continue;
  }
  if (
    b >= 0xe0 &&
    b <= 0xef &&
    i + 2 < buf.length &&
    buf[i + 1] >= 0x80 &&
    buf[i + 1] <= 0xbf &&
    buf[i + 2] >= 0x80 &&
    buf[i + 2] <= 0xbf
  ) {
    out += String.fromCharCode(((b & 0x0f) << 12) | ((buf[i + 1] & 0x3f) << 6) | (buf[i + 2] & 0x3f));
    i += 3;
    continue;
  }
  out += String.fromCharCode(b);
  fixed++;
  i++;
}

fs.writeFileSync(file, out, "utf8");
console.log(`rewrote ${file}: ${fixed} orphan byte(s) normalized to UTF-8`);
