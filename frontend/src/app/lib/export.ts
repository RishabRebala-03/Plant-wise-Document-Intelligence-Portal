export type ExportCell = string | number | boolean | null | undefined;
export type ExportRow = Record<string, ExportCell>;

function downloadBlob(content: BlobPart, fileName: string, type: string) {
  const blob = new Blob([content], { type });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

function escapeCsv(value: string) {
  const normalized = value.replace(/"/g, "\"\"");
  return /[",\n]/.test(normalized) ? `"${normalized}"` : normalized;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function exportHeaders(rows: ExportRow[]) {
  return Array.from(
    rows.reduce((headers, row) => {
      Object.keys(row).forEach((key) => headers.add(key));
      return headers;
    }, new Set<string>()),
  );
}

export function exportRowsToCsv(rows: ExportRow[], fileName: string) {
  const headers = exportHeaders(rows);
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => escapeCsv(String(row[header] ?? ""))).join(",")),
  ];
  downloadBlob(`\uFEFF${lines.join("\n")}`, fileName, "text/csv;charset=utf-8;");
}

export function exportRowsToExcel(rows: ExportRow[], fileName: string) {
  const headers = exportHeaders(rows);
  const tableRows = rows.map((row) => (
    `<tr>${headers.map((header) => `<td>${escapeHtml(String(row[header] ?? ""))}</td>`).join("")}</tr>`
  )).join("");
  const workbook = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="UTF-8" />
      </head>
      <body>
        <table>
          <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </body>
    </html>
  `;
  downloadBlob(workbook, fileName, "application/vnd.ms-excel;charset=utf-8;");
}
