import fs from "node:fs";
import path from "node:path";

function escapePdfText(value) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function buildPdf(title, subtitle, lines, stamp) {
  const content = [];
  content.push("0.92 0.94 0.90 rg");
  content.push("72 96 468 624 re f");
  content.push("0.16 0.20 0.17 RG");
  content.push("2 w");
  content.push("72 96 468 624 re S");
  content.push("0.10 0.12 0.10 rg");
  content.push("BT");
  content.push("/F2 21 Tf");
  content.push("108 668 Td");
  content.push(`(${escapePdfText(title)}) Tj`);
  content.push("0 -30 Td");
  content.push("/F1 11 Tf");
  content.push(`(${escapePdfText(subtitle)}) Tj`);
  let offset = -22;
  for (const line of lines) {
    content.push(`0 ${offset} Td`);
    content.push(`(${escapePdfText(line)}) Tj`);
    offset -= 16;
  }
  content.push("ET");
  content.push("0.06 0.45 0.28 rg");
  content.push("BT");
  content.push("/F2 13 Tf");
  content.push("108 132 Td");
  content.push(`(${escapePdfText(stamp)}) Tj`);
  content.push("ET");
  content.push("0.06 0.45 0.28 RG");
  content.push("1.6 w");
  content.push("100 118 190 26 re S");
  content.push("0.55 0.60 0.55 rg");
  content.push("BT");
  content.push("/F1 8 Tf");
  content.push("108 690 Td");
  content.push("(FIXTURE PDF - DEMO DATA - NO ES UN DOCUMENTO REAL) Tj");
  content.push("ET");
  const stream = content.join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  ];

  let file = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(file.length);
    file += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = file.length;
  file += `xref\n0 ${objects.length + 1}\n`;
  file += "0000000000 65535 f \n";
  for (let i = 1; i <= objects.length; i++) {
    file += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  file += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return file;
}

const outDir = path.resolve("private-fixtures");
const fixtures = [
  ["costa-norte", "plano-rev-c.pdf", "PLANO GENERAL - REV C", "OBRA COSTA NORTE - ESTRUCTURA Y ARQUITECTURA", ["Escala 1:100", "Aprobado por jefatura de obra", "Fecha de emision: 05/10/2026"], "APROBADO PARA OBRA"],
  ["costa-norte", "plano-rev-b.pdf", "PLANO GENERAL - REV B", "OBRA COSTA NORTE - ESTRUCTURA Y ARQUITECTURA", ["Reemplazado por la revision C", "Fecha de emision: 14/08/2026"], "SUPERADO - NO CONSTRUIR"],
  ["parque-industrial", "instalaciones-a.pdf", "PLANO INSTALACIONES - REV A", "PARQUE INDUSTRIAL - NAVE A", ["Instalaciones electromecanicas", "Fecha de emision: 20/09/2026"], "PENDIENTE DE REVISION"],
  ["parque-industrial", "instalaciones-a-copy.pdf", "PLANO INSTALACIONES - REV A (COPIA)", "PARQUE INDUSTRIAL - NAVE A", ["Posible duplicado del original", "Mismo tamano y contenido"], "POSIBLE DUPLICADO"],
  ["torre-del-parque", "fachada.pdf", "FACHADA PRINCIPAL", "TORRE DEL PARQUE - ALZADO PRINCIPAL", ["Escala 1:50", "Aprobado por jefatura de obra", "Fecha de emision: 01/10/2026"], "APROBADO PARA OBRA"],
];

for (const [scenario, name, title, subtitle, lines, stamp] of fixtures) {
  const dir = path.join(outDir, scenario);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), buildPdf(title, subtitle, lines, stamp), "latin1");
  console.log(`wrote private-fixtures/${scenario}/${name}`);
}
