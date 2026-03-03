export type OutputFormat = "table" | "json" | "csv";

export function outputAs(
  format: OutputFormat,
  data: Record<string, unknown>[] | Record<string, unknown>,
  renderFn: () => void,
): void {
  switch (format) {
    case "json":
      console.log(JSON.stringify(data, null, 2));
      break;
    case "csv": {
      const rows = Array.isArray(data) ? data : [data];
      if (rows.length === 0) return;
      const headers = Object.keys(rows[0]);
      console.log(headers.join(","));
      for (const row of rows) {
        console.log(headers.map((h) => csvEscape(String(row[h] ?? ""))).join(","));
      }
      break;
    }
    case "table":
    default:
      renderFn();
      break;
  }
}

function csvEscape(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}
