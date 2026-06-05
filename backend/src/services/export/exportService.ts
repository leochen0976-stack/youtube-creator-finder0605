import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { env } from "../../config/env.js";
import type { CreatorResult } from "../../types/result.js";
import type { ExportFormat } from "../../types/export.js";
import { normalizeCountryCode } from "../channelIntelligence/countryMap.js";

export interface ExportColumn {
  label: string;
  value: (result: CreatorResult) => string | number | null | undefined;
}

export const exportColumns: ExportColumn[] = [
  { label: "频道名字", value: (result) => result.channel_title },
  { label: "频道链接", value: (result) => (result.channel_id ? `https://www.youtube.com/channel/${result.channel_id}` : "") },
  { label: "国家", value: (result) => normalizeCountry(result.channel_normalized_country || result.channel_country) },
  { label: "语言", value: (result) => normalizeLanguage(result.channel_language) },
  { label: "邮箱", value: (result) => result.public_email },
  { label: "粉丝数", value: (result) => formatCompactNumber(result.subscribers) }
];

const LANGUAGE_ALIASES: Record<string, string> = {
  en: "English",
  "en-us": "English",
  "en-gb": "English",
  english: "English",
  英语: "English",
  zh: "Chinese",
  "zh-cn": "Chinese",
  "zh-tw": "Chinese",
  chinese: "Chinese",
  中文: "Chinese",
  ja: "Japanese",
  japanese: "Japanese",
  日语: "Japanese",
  ko: "Korean",
  korean: "Korean",
  韩语: "Korean",
  es: "Spanish",
  spanish: "Spanish",
  fr: "French",
  french: "French",
  de: "German",
  german: "German",
  pt: "Portuguese",
  portuguese: "Portuguese",
  ru: "Russian",
  russian: "Russian"
};

function normalizeCountry(value: string | null | undefined): string {
  return normalizeCountryCode(value) || "Other";
}

function normalizeLanguage(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "Other";
  const key = raw.toLowerCase();
  const prefix = key.split("-")[0] ?? key;
  return LANGUAGE_ALIASES[key] ?? LANGUAGE_ALIASES[prefix] ?? raw;
}

function formatCompactNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const absoluteValue = Math.abs(value);
  const formatUnit = (divisor: number, unit: "K" | "M") => {
    const scaled = value / divisor;
    const decimals = Math.abs(scaled) < 100 && !Number.isInteger(scaled) ? 1 : 0;
    return `${scaled.toFixed(decimals).replace(/\.0$/, "")}${unit}`;
  };

  if (absoluteValue >= 1_000_000) return formatUnit(1_000_000, "M");
  if (absoluteValue >= 1_000) return formatUnit(1_000, "K");
  return String(value);
}

function ensureExportDirectory(): string {
  const dir = path.isAbsolute(env.EXPORT_DIR) ? env.EXPORT_DIR : path.resolve(process.cwd(), env.EXPORT_DIR);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function normalizeCell(value: unknown): string | number {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return value;
  return String(value);
}

export function createExportRows(results: CreatorResult[]): Record<string, string | number>[] {
  return results.map((result) =>
    Object.fromEntries(exportColumns.map((column) => [column.label, normalizeCell(column.value(result))]))
  );
}

export function writeCsvExport(filePath: string, rows: Record<string, string | number>[]): void {
  const headers = exportColumns.map((column) => column.label);
  const csvLines = [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((header) => {
          const raw = String(row[header] ?? "");
          const escaped = raw.replaceAll('"', '""');
          return /[",\r\n]/.test(escaped) ? `"${escaped}"` : escaped;
        })
        .join(",")
    )
  ];
  fs.writeFileSync(filePath, `\uFEFF${csvLines.join("\r\n")}`, "utf8");
}

export function writeXlsxExport(filePath: string, rows: Record<string, string | number>[]): void {
  const worksheet = XLSX.utils.json_to_sheet(rows, {
    header: exportColumns.map((column) => column.label)
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "results");
  XLSX.writeFile(workbook, filePath);
}

export function createExportFile(jobId: string, format: ExportFormat, results: CreatorResult[]): {
  filePath: string;
  rowCount: number;
} {
  const exportDir = ensureExportDirectory();
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const filePath = path.join(exportDir, `${jobId}-${timestamp}.${format}`);
  const rows = createExportRows(results);

  if (format === "csv") {
    writeCsvExport(filePath, rows);
  } else {
    writeXlsxExport(filePath, rows);
  }

  return {
    filePath,
    rowCount: rows.length
  };
}
