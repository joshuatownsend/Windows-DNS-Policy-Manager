# Zones Enhancements: Pagination + Bulk Import/Export — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan.

**Goal:** Add client-side pagination to the record table (prevents UI lock on large zones) and CSV-based bulk record import/export.

**Architecture:** Pagination is pure client-side — slice `filteredRecords` by page. Import/Export adds a new component with file upload (reusing backup page's drag-drop pattern) and CSV generation.

**Tech Stack:** React, shadcn/ui, existing `api.addZoneRecord()` / `api.getZoneRecords()`.

---

## Feature 1: Record Pagination

### Files
- Modify: `dns-manager/src/app/zones/page.tsx` — add page state, paginate `filteredRecords`, add page controls

### Design
- Page size: 50 records (sensible for DNS record tables)
- Controls below the table: "< Prev | Page X of Y | Next >"
- Showing "X-Y of Z records" count
- Reset to page 1 when filters change or zone changes

### Tasks

- [ ] Add pagination state: `const [page, setPage] = useState(0); const pageSize = 50;`
- [ ] Compute `paginatedRecords = filteredRecords.slice(page * pageSize, (page + 1) * pageSize)` and `totalPages`
- [ ] Replace `filteredRecords.map(...)` in the table body with `paginatedRecords.map(...)`
- [ ] Add pagination controls below the table: Prev/Next buttons + page indicator
- [ ] Reset page to 0 when `zoneRecordFilter` or `selectedZone` changes (useEffect)
- [ ] Update record count display: "Showing X-Y of Z records"
- [ ] Commit

---

## Feature 2: Bulk Record Export

### Files
- Create: `dns-manager/src/components/zones/record-export.tsx`
- Modify: `dns-manager/src/app/zones/page.tsx` — add Export button in records header

### Design
Export the current zone's records (or filtered subset) as CSV:
```csv
HostName,RecordType,Data,TTL
www,A,192.168.1.10,00:05:00
mail,A,192.168.1.20,01:00:00
@,MX,mail.contoso.com. (10),01:00:00
```

### Tasks

- [ ] Create `record-export.tsx` with an `exportRecordsCsv(records, zoneName)` function
- [ ] CSV generation: header row + one row per record, with RecordData flattened to a readable string
- [ ] Trigger download via Blob + object URL + hidden anchor click
- [ ] Add "Export CSV" button in the records section header (next to "Add Record")
- [ ] Commit

---

## Feature 3: Bulk Record Import

### Files
- Create: `dns-manager/src/components/zones/record-import.tsx` — dialog with file upload, preview, and import logic
- Modify: `dns-manager/src/app/zones/page.tsx` — add Import button + dialog trigger

### CSV Format (for import)
```csv
HostName,RecordType,Data,TTL
www,A,192.168.1.10,300
ftp,CNAME,ftp.contoso.com,3600
@,MX,mail.contoso.com:10,3600
```

Rules:
- RecordType determines how Data is interpreted (A→IPv4, AAAA→IPv6, CNAME→alias, MX→host:preference, SRV→host:priority:weight:port, TXT→text, NS→nameserver, PTR→domain)
- TTL in seconds
- Lines starting with # are comments
- Header row is optional (auto-detected)

### Tasks

- [ ] Create `record-import.tsx` with drag-drop file upload (reuse backup page pattern)
- [ ] CSV parser: split lines, parse fields, map to record objects
- [ ] Preview table showing parsed records with validation status
- [ ] Import button: iterate records, call `api.addZoneRecord()` per record with progress bar
- [ ] Error handling: show per-record pass/fail, continue on failure
- [ ] Add "Import CSV" button in records header → opens dialog
- [ ] Commit

---

## Task 4: Docs and Cleanup

- [ ] Update `docs/help/zones.md` — add Export/Import and pagination sections
- [ ] Copy to `dns-manager/public/help/zones.md`
- [ ] Update `CHANGELOG.md`
- [ ] Update `TODO.md` — remove completed items
- [ ] Remove PWA item from TODO (contradicts architecture)
- [ ] Commit
