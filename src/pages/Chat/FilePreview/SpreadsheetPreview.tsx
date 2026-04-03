import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx';
import { invokeIpc } from '@/lib/api-client';
import { hostApiFetch } from '@/lib/host-api';
import { getFileName } from './utils';

type SpreadsheetPreviewProps = {
  activeFile: string;
};

type FileContentResponse = {
  filePath: string;
  mimeType: string;
  fileSize: number;
  base64: string;
};

type ParsedSheet = {
  name: string;
  rows: string[][];
};

const MAX_PREVIEW_ROWS = 300;
const MAX_PREVIEW_COLS = 40;

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function getColumnLabel(index: number): string {
  let n = index + 1;
  let label = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

export function SpreadsheetPreview({ activeFile }: SpreadsheetPreviewProps) {
  const fileName = getFileName(activeFile);
  const requestPath = useMemo(
    () => `/api/files/content?filePath=${encodeURIComponent(activeFile)}`,
    [activeFile]
  );
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sheets, setSheets] = useState<ParsedSheet[]>([]);
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);

  useEffect(() => {
    let disposed = false;

    void hostApiFetch<FileContentResponse>(requestPath)
      .then((result) => {
        if (disposed) return;
        const workbook = XLSX.read(base64ToUint8Array(result.base64), { type: 'array' });
        const parsedSheets = workbook.SheetNames.map((sheetName) => {
          const sheet = workbook.Sheets[sheetName];
          const data = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
            header: 1,
            raw: false,
            defval: '',
          });
          const normalized = data
            .slice(0, MAX_PREVIEW_ROWS)
            .map((row) =>
              row
                .slice(0, MAX_PREVIEW_COLS)
                .map((cell) => (cell == null ? '' : String(cell)))
            );
          return { name: sheetName, rows: normalized };
        });

        setSheets(parsedSheets);
        setActiveSheetIndex(0);
        setIsLoading(false);
      })
      .catch((error) => {
        if (disposed) return;
        setLoadError(error instanceof Error ? error.message : String(error));
        setIsLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [requestPath]);

  const activeSheet = sheets[activeSheetIndex] ?? null;
  const rowCount = activeSheet?.rows.length ?? 0;
  const colCount = activeSheet?.rows.reduce((max, row) => Math.max(max, row.length), 0) ?? 0;

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="h-11 shrink-0 border-b px-3 py-2 text-xs text-muted-foreground">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4" />
            <span className="truncate" title={activeFile}>
              {fileName}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              void invokeIpc('shell:openPath', activeFile);
            }}
            className="inline-flex shrink-0 items-center gap-1 rounded border px-2 py-1 text-[11px] text-foreground transition-colors hover:bg-accent"
            title="在系统默认应用中打开"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            打开
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden bg-muted/20">
        {loadError ? (
          <div className="flex h-full items-center justify-center px-4">
            <div className="rounded-2xl border border-dashed border-black/10 bg-black/[0.02] px-8 py-7 text-center dark:border-white/10 dark:bg-white/[0.03]">
              <p className="text-sm text-muted-foreground">表格预览加载失败：{loadError}</p>
            </div>
          </div>
        ) : isLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            正在加载表格预览...
          </div>
        ) : sheets.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            未读取到可预览的工作表内容
          </div>
        ) : (
          <div className="flex h-full min-h-0 flex-col">
            <div className="shrink-0 border-b px-2 py-1.5">
              <div className="flex items-center gap-1 overflow-x-auto">
                {sheets.map((sheet, index) => (
                  <button
                    key={sheet.name}
                    type="button"
                    onClick={() => setActiveSheetIndex(index)}
                    className={`shrink-0 rounded px-2 py-1 text-xs transition-colors ${
                      index === activeSheetIndex
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-accent text-foreground'
                    }`}
                  >
                    {sheet.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {rowCount === 0 || colCount === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  当前工作表暂无内容
                </div>
              ) : (
                <table className="min-w-full border-collapse text-xs">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="sticky top-0 left-0 z-20 w-12 border-r px-2 py-1.5 text-right font-medium text-muted-foreground bg-[#f0f0f0] dark:bg-[#333333]">
                        
                      </th>
                      {Array.from({ length: colCount }).map((_, colIndex) => (
                        <th
                          key={`col-${colIndex}`}
                          className="sticky top-0 z-10 border-r px-2 py-1.5 text-left font-medium text-muted-foreground bg-[#f0f0f0] dark:bg-[#333333]"
                        >
                          {getColumnLabel(colIndex)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: rowCount }).map((_, rowIndex) => {
                      const row = activeSheet?.rows[rowIndex] ?? [];
                      return (
                        <tr key={`${activeSheet?.name ?? 'sheet'}-${rowIndex}`} className="border-b">
                          <td className="sticky left-0 z-10 w-12 border-r px-2 py-1.5 text-right text-muted-foreground bg-[#f0f0f0] dark:bg-[#333333]">
                            {rowIndex + 1}
                          </td>
                          {Array.from({ length: colCount }).map((__, colIndex) => (
                            <td
                              key={`${rowIndex}-${colIndex}`}
                              className="max-w-[360px] border-r px-2 py-1.5 align-top break-words text-foreground/90"
                            >
                              {row[colIndex] ?? ''}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
