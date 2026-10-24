"use client";

import type { DnsRecord } from "@/lib/types";
import { csvRow, RECORD_CSV_HEADER } from "@/lib/csv";

function flattenRecordData(record: DnsRecord): string {
  const d = record.RecordData;
  if (!d) return "";
  switch (record.RecordType) {
    case "A": return String(d.IPv4Address || "");
    case "AAAA": return String(d.IPv6Address || "");
    case "CNAME": return String(d.HostNameAlias || "");
    case "MX": return `${d.MailExchange || ""}:${d.Preference || 10}`;
    case "NS": return String(d.NameServer || "");
    case "PTR": return String(d.PtrDomainName || "");
    case "SRV": return `${d.DomainName || ""}:${d.Priority || 0}:${d.Weight || 0}:${d.Port || 0}`;
    case "TXT": return String(d.DescriptiveText || "");
    default: return JSON.stringify(d);
  }
}

export function exportRecordsCsv(records: DnsRecord[], zoneName: string) {
  const header = RECORD_CSV_HEADER;
  const rows = records.map((r) =>
    csvRow([r.HostName, r.RecordType, flattenRecordData(r), r.TimeToLive || ""]),
  );

  const csv = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${zoneName}-records.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
