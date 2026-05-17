import { useState, useEffect } from "preact/hooks";
import { parseDelimited } from "../../utils/delimited-preview";
import type { DelimitedPreviewResult } from "../../utils/delimited-preview";

interface DelimitedTableProps {
  mediaId: number;
  filename: string;
}

export function DelimitedTable({ mediaId, filename }: DelimitedTableProps) {
  const [result, setResult] = useState<DelimitedPreviewResult | null | undefined>(undefined);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/media/${mediaId}`, { credentials: "same-origin" })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then(text => {
        if (!cancelled) {
          const parsed = parseDelimited(text);
          setResult(parsed);
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => { cancelled = true; };
  }, [mediaId]);

  if (error || result === null) return null;
  if (result === undefined) return null;

  const truncated = result.totalRows > result.rows.length;

  return (
    <div className="delimited-table">
      <div className="delimited-table__header">
        {filename} — {result.headers.length} columns × {result.totalRows} rows
      </div>
      <div className="delimited-table__scroll">
        <table className="delimited-table__grid">
          <thead>
            <tr>
              {result.headers.map((h, i) => (
                <th key={i}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci} title={cell}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {truncated && (
        <div className="delimited-table__footer">
          Showing {result.rows.length} of {result.totalRows} rows
        </div>
      )}
    </div>
  );
}
