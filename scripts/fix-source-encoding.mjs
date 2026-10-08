import fs from "node:fs";
import path from "node:path";

function decodeLenient(buf) {
  let out = "";
  let i = 0;
  let orphans = 0;
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
    if (
      b >= 0xf0 &&
      b <= 0xf4 &&
      i + 3 < buf.length &&
      buf[i + 1] >= 0x80 &&
      buf[i + 1] <= 0xbf &&
      buf[i + 2] >= 0x80 &&
      buf[i + 2] <= 0xbf &&
      buf[i + 3] >= 0x80 &&
      buf[i + 3] <= 0xbf
    ) {
      out += String.fromCharCode(
        ((b & 0x07) << 18) | ((buf[i + 1] & 0x3f) << 12) | ((buf[i + 2] & 0x3f) << 6) | (buf[i + 3] & 0x3f)
      );
      i += 4;
      continue;
    }
    out += String.fromCharCode(b);
    orphans++;
    i++;
  }
  return { out, orphans };
}

function walk(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) results.push(full);
  }
  return results;
}

let totalFixed = 0;
for (const file of walk("app")) {
  const buf = fs.readFileSync(file);
  const { out, orphans } = decodeLenient(buf);
  if (orphans > 0) {
    fs.writeFileSync(file, out, "utf8");
    console.log(`fixed ${orphans} orphan byte(s) in ${file}`);
    totalFixed += orphans;
  }
}
console.log(totalFixed === 0 ? "no orphan bytes found in app/" : `total: ${totalFixed} orphan byte(s) normalized`);
