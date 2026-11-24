/**
 * أدوات التصدير الموحّدة (Excel / CSV / ZIP) — بدون أي اعتماديات خارجية.
 *
 * - ملفات CSV تُصدَّر بترميز UTF-8 مع BOM حتى تظهر الحروف العربية صحيحة في Excel.
 * - الحزمة (ZIP) تُبنى بطريقة STORE (بدون ضغط) عبر CRC32 محلي، لتفادي إضافة
 *   مكتبات مثل `xlsx` أو `jszip` إلى المشروع.
 */

export type CsvValue = string | number | boolean | null | undefined;

/** BOM ضروري ليقرأ Excel محتوى UTF-8 بشكل صحيح. */
const UTF8_BOM = '\uFEFF';

/** يهرّب خلية CSV ويحمي من حقن معادلات Excel (CSV Formula Injection). */
export function escapeCsvCell(value: CsvValue): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const needsFormulaGuard =
    raw.length > 0 &&
    /^[=+\-@\t\r]/.test(raw) &&
    !(typeof value === 'number' && Number.isFinite(value));
  const text = needsFormulaGuard ? `'${raw}` : raw;
  return `"${text.replace(/"/g, '""')}"`;
}

/** يبني نص CSV (بدون BOM) من صف ترويسة وصفوف البيانات. */
export function buildCsvRows(headers: CsvValue[], rows: CsvValue[][]): string {
  return [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((row) => row.map(escapeCsvCell).join(','))
  ].join('\r\n');
}

/** يبني نص CSV جاهزاً للتنزيل مع BOM لدعم العربية في Excel. */
export function buildCsv(headers: CsvValue[], rows: CsvValue[][]): string {
  return UTF8_BOM + buildCsvRows(headers, rows);
}

/** ينزّل Blob كملف باسم محدد عبر رابط مؤقت. */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** ينزّل ملف CSV مباشرة من ترويسة وصفوف. */
export function exportCsv(filename: string, headers: CsvValue[], rows: CsvValue[][]): void {
  downloadBlob(filename, new Blob([buildCsv(headers, rows)], { type: 'text/csv;charset=utf-8;' }));
}

/** يبني اسم ملف مؤرخ (YYYY-MM-DD) لتفادي تكرار الأسماء. */
export function datedFileName(prefix: string, extension: string = 'csv'): string {
  return `${prefix}_${new Date().toISOString().slice(0, 10)}.${extension}`;
}

/** ورقة واحدة داخل حزمة ZIP. */
export interface CsvSheet {
  /** اسم الملف داخل الأرشيف (بدون امتداد سيُضاف تلقائياً). */
  name: string;
  headers: CsvValue[];
  rows: CsvValue[][];
}

/** ملف جاهز داخل الأرشيف. */
export interface ZipEntry {
  name: string;
  content: string;
}

/** جدول CRC32 (IEEE 802.3) — يُحسب مرة واحدة عند تحميل الموديول. */
const CRC32_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let k = 0; k < 8; k += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[n] = value >>> 0;
  }
  return table;
})();

/** يحسب CRC32 لمصفوفة بايتات (مطلوب في ترويسة ZIP). */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** مخزن بايتات متنامٍ لبناء أرشيف ZIP بايتاً بايتاً بأمان. */
class ByteBuffer {
  private bytes = new Uint8Array(1024);
  private length = 0;

  get size(): number {
    return this.length;
  }

  private ensure(extra: number): void {
    const required = this.length + extra;
    if (required <= this.bytes.length) return;
    let capacity = this.bytes.length;
    while (capacity < required) capacity *= 2;
    const grown = new Uint8Array(capacity);
    grown.set(this.bytes.subarray(0, this.length));
    this.bytes = grown;
  }

  writeByte(value: number): void {
    this.ensure(1);
    this.bytes[this.length] = value & 0xff;
    this.length += 1;
  }

  writeUint16(value: number): void {
    this.writeByte(value);
    this.writeByte(value >>> 8);
  }

  writeUint32(value: number): void {
    this.writeByte(value);
    this.writeByte(value >>> 8);
    this.writeByte(value >>> 16);
    this.writeByte(value >>> 24);
  }

  writeBytes(source: Uint8Array): void {
    this.ensure(source.length);
    this.bytes.set(source, this.length);
    this.length += source.length;
  }

  toUint8Array(): Uint8Array {
    return this.bytes.slice(0, this.length);
  }
}


/**
 * يبني Blob بصيغة ZIP (STORE بدون ضغط) من عدة ملفات نصية UTF-8.
 * يُستخدم لتنزيل عدة أوراق CSV في حزمة واحدة من زر واحد.
 */
export function buildZipBlob(entries: ZipEntry[]): Blob {
  const encoder = new TextEncoder();
  const now = new Date();
  const dosTime =
    ((now.getHours() & 0x1f) << 11) |
    ((now.getMinutes() & 0x3f) << 5) |
    ((now.getSeconds() >> 1) & 0x1f);
  const dosDate =
    ((((now.getFullYear() - 1980) & 0x7f) << 9) |
      (((now.getMonth() + 1) & 0x0f) << 5) |
      (now.getDate() & 0x1f)) >>>
    0;

  const localBuffer = new ByteBuffer();
  const centralBuffer = new ByteBuffer();
  const records: { nameBytes: Uint8Array; crc: number; size: number; offset: number }[] = [];

  // 1) بيانات الملفات + الترويسات المحلية.
  entries.forEach((entry) => {
    const nameBytes = encoder.encode(entry.name);
    const dataBytes = encoder.encode(entry.content);
    const checksum = crc32(dataBytes);
    const size = dataBytes.length;
    const offset = localBuffer.size;

    localBuffer.writeUint32(0x04034b50); // Local file header signature
    localBuffer.writeUint16(20); // Version needed to extract
    localBuffer.writeUint16(0x0800); // General purpose flag: UTF-8
    localBuffer.writeUint16(0); // Compression method: STORE
    localBuffer.writeUint16(dosTime);
    localBuffer.writeUint16(dosDate);
    localBuffer.writeUint32(checksum);
    localBuffer.writeUint32(size); // Compressed size
    localBuffer.writeUint32(size); // Uncompressed size
    localBuffer.writeUint16(nameBytes.length);
    localBuffer.writeUint16(0); // Extra field length
    localBuffer.writeBytes(nameBytes);
    localBuffer.writeBytes(dataBytes);

    records.push({ nameBytes, crc: checksum, size, offset });
  });

  const centralOffset = localBuffer.size;

  // 2) الدليل المركزي (Central directory).
  records.forEach(({ nameBytes, crc, size, offset }) => {
    centralBuffer.writeUint32(0x02014b50); // Central directory header signature
    centralBuffer.writeUint16(20); // Version made by
    centralBuffer.writeUint16(20); // Version needed
    centralBuffer.writeUint16(0x0800); // UTF-8 flag
    centralBuffer.writeUint16(0); // Method: STORE
    centralBuffer.writeUint16(dosTime);
    centralBuffer.writeUint16(dosDate);
    centralBuffer.writeUint32(crc);
    centralBuffer.writeUint32(size);
    centralBuffer.writeUint32(size);
    centralBuffer.writeUint16(nameBytes.length);
    centralBuffer.writeUint16(0); // Extra length
    centralBuffer.writeUint16(0); // Comment length
    centralBuffer.writeUint16(0); // Disk number start
    centralBuffer.writeUint16(0); // Internal attributes
    centralBuffer.writeUint32(0); // External attributes
    centralBuffer.writeUint32(offset); // Local header offset
    centralBuffer.writeBytes(nameBytes);
  });

  const centralSize = centralBuffer.size;

  // 3) سجل نهاية الدليل المركزي (End of central directory).
  const endBuffer = new ByteBuffer();
  endBuffer.writeUint32(0x06054b50);
  endBuffer.writeUint16(0); // Number of this disk
  endBuffer.writeUint16(0); // Disk with central directory
  endBuffer.writeUint16(entries.length); // Entries on this disk
  endBuffer.writeUint16(entries.length); // Total entries
  endBuffer.writeUint32(centralSize);
  endBuffer.writeUint32(centralOffset);
  endBuffer.writeUint16(0); // Comment length

  const localBytes = localBuffer.toUint8Array();
  const centralBytes = centralBuffer.toUint8Array();
  const endBytes = endBuffer.toUint8Array();
  const archive = new Uint8Array(localBytes.length + centralBytes.length + endBytes.length);
  archive.set(localBytes, 0);
  archive.set(centralBytes, localBytes.length);
  archive.set(endBytes, localBytes.length + centralBytes.length);

  return new Blob([archive], { type: 'application/zip' });
}

/** ينزّل حزمة ZIP تضم عدة أوراق CSV (كل ورقة ملف مستقل). */
export function exportZipCsv(filename: string, sheets: CsvSheet[]): void {
  const entries: ZipEntry[] = sheets.map((sheet) => {
    const name = /\.csv$/i.test(sheet.name) ? sheet.name : `${sheet.name}.csv`;
    return { name, content: buildCsv(sheet.headers, sheet.rows) };
  });
  downloadBlob(filename, buildZipBlob(entries));
}
