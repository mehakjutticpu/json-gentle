import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { statusLabel, type ReportRow } from "./ledger";

function stamp() {
  return new Date().toLocaleString("en-GB");
}

export function exportExcel(rows: ReportRow[]) {
  const data = rows.map((r) => ({
    "CUSTOMER NAME": r.name,
    CITY: r.city,
    "COMPUTER AMOUNT": r.computer,
    "MANUAL AMOUNT": r.manual ?? "",
    DIFFERENCE: r.manual === null ? "" : r.difference,
    STATUS: statusLabel[r.status],
  }));
  const sheet = XLSX.utils.json_to_sheet(data);
  sheet["!cols"] = [{ wch: 42 }, { wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 16 }, { wch: 18 }];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Report");
  XLSX.writeFile(book, `RDX-Account-Zone-${Date.now()}.xlsx`);
}

export function exportPdf(rows: ReportRow[], totals: { computer: number; manual: number; diff: number }) {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  doc.setFontSize(18);
  doc.text("RDX ACCOUNT ZONE", 40, 40);
  doc.setFontSize(10);
  doc.text(`Comparison Report  |  ${stamp()}  |  ${rows.length} accounts`, 40, 58);
  doc.text(
    `Computer Total: ${totals.computer.toLocaleString()}   Manual Total: ${totals.manual.toLocaleString()}   Difference: ${totals.diff.toLocaleString()}`,
    40,
    74,
  );

  autoTable(doc, {
    startY: 92,
    head: [["CUSTOMER NAME", "CITY", "COMPUTER", "MANUAL", "DIFFERENCE", "STATUS"]],
    body: rows.map((r) => [
      r.name,
      r.city,
      r.computer.toLocaleString(),
      r.manual === null ? "-" : r.manual.toLocaleString(),
      r.manual === null ? "-" : r.difference.toLocaleString(),
      statusLabel[r.status],
    ]),
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [17, 24, 39], textColor: [250, 204, 21] },
    alternateRowStyles: { fillColor: [245, 245, 244] },
    columnStyles: {
      2: { halign: "right" },
      3: { halign: "right" },
      4: { halign: "right" },
    },
  });

  doc.save(`RDX-Account-Zone-${Date.now()}.pdf`);
}
