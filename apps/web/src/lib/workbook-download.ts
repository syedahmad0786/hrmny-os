type Sheet = { name: string; headers: string[]; rows: string[][] };
const xml = (s: string) =>
  s
    // XML 1.0 forbids these control characters in prospect-supplied text.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const encoder = new TextEncoder();
function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function binary(size: number) {
  const bytes = new Uint8Array(size);
  return { bytes, view: new DataView(bytes.buffer) };
}

/** Small standards-based XLSX export. Text cells never execute prospect-supplied formulas. */
export function workbookXlsx(sheets: Sheet[]): Uint8Array {
  if (
    !sheets.length ||
    sheets.length > 20 ||
    sheets.some((s) => s.rows.length > 100000 || s.headers.length > 100)
  )
    throw new Error(
      "Workbook export exceeds the supported size. Filter the view first.",
    );
  const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const rel = "http://schemas.openxmlformats.org/package/2006/relationships";
  const office =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const files: [string, string][] = [
    [
      "[Content_Types].xml",
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
    ],
    [
      "_rels/.rels",
      `<Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${office}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ],
    [
      "xl/workbook.xml",
      `<workbook xmlns="${ns}" xmlns:r="${office}"><sheets>${sheets.map((s, i) => `<sheet name="${xml(s.name.replace(/[\\/*?:[\]]/g, "").slice(0, 31) || `Sheet ${i + 1}`)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
    ],
    [
      "xl/_rels/workbook.xml.rels",
      `<Relationships xmlns="${rel}">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${office}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`,
    ],
  ];
  sheets.forEach((sheet, index) => {
    const rows = [sheet.headers, ...sheet.rows];
    files.push([
      `xl/worksheets/sheet${index + 1}.xml`,
      `<worksheet xmlns="${ns}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${rows.map((row, y) => `<row r="${y + 1}">${row.map((cell, x) => `<c r="${columnName(x)}${y + 1}" t="inlineStr"><is><t xml:space="preserve">${xml(String(cell).slice(0, 32767))}</t></is></c>`).join("")}</row>`).join("")}</sheetData><autoFilter ref="A1:${columnName(sheet.headers.length - 1)}${rows.length}"/></worksheet>`,
    ]);
  });
  // ponytail: uncompressed ZIP for bounded CRM exports; use a streaming archive library if exports exceed 100k rows.
  const parts: Uint8Array[] = [],
    directory: Uint8Array[] = [];
  let offset = 0;
  for (const [path, content] of files) {
    const name = encoder.encode(path),
      data = encoder.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${content}`,
      ),
      crc = crc32(data);
    const local = binary(30 + name.length);
    local.view.setUint32(0, 0x04034b50, true);
    local.view.setUint16(4, 20, true);
    local.view.setUint32(14, crc, true);
    local.view.setUint32(18, data.length, true);
    local.view.setUint32(22, data.length, true);
    local.view.setUint16(26, name.length, true);
    local.bytes.set(name, 30);
    const central = binary(46 + name.length);
    central.view.setUint32(0, 0x02014b50, true);
    central.view.setUint16(4, 20, true);
    central.view.setUint16(6, 20, true);
    central.view.setUint32(16, crc, true);
    central.view.setUint32(20, data.length, true);
    central.view.setUint32(24, data.length, true);
    central.view.setUint16(28, name.length, true);
    central.view.setUint32(42, offset, true);
    central.bytes.set(name, 46);
    parts.push(local.bytes, data);
    directory.push(central.bytes);
    offset += local.bytes.length + data.length;
  }
  const end = binary(22),
    directorySize = directory.reduce((sum, part) => sum + part.length, 0);
  end.view.setUint32(0, 0x06054b50, true);
  end.view.setUint16(8, files.length, true);
  end.view.setUint16(10, files.length, true);
  end.view.setUint32(12, directorySize, true);
  end.view.setUint32(16, offset, true);
  const output = new Uint8Array(offset + directorySize + 22);
  let cursor = 0;
  for (const part of [...parts, ...directory, end.bytes]) {
    output.set(part, cursor);
    cursor += part.length;
  }
  return output;
}

export function downloadWorkbookFile(
  content: string | Uint8Array,
  filename: string,
  type: string,
) {
  const blob = new Blob(
    [typeof content === "string" ? content : new Uint8Array(content).buffer],
    { type },
  );
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
