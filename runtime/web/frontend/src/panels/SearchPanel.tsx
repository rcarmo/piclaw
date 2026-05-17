import { useState, useEffect, useRef, useCallback } from "preact/hooks";
import { CustomSelect } from "../components/CustomSelect";

interface SearchResult {
  id: string | number;
  text?: string;
  content?: string;
  role?: string;
  created_at?: string;
  timestamp?: string;
  channel?: string;
}

interface SearchResponse {
  results?: SearchResult[];
  messages?: SearchResult[];
  items?: SearchResult[];
}

type SearchScope = "current" | "root" | "all";

function formatTime(ts: string | undefined): string {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return ts;
  }
}

function getSnippet(result: SearchResult): string {
  const r = result as unknown as Record<string, unknown>;
  const data = r.data as Record<string, unknown> | undefined;
  const text = result.text ?? result.content ?? (data?.content as string) ?? "";
  return typeof text === "string" ? text.slice(0, 300) : "";
}

function getTimestamp(result: SearchResult): string {
  return result.created_at ?? result.timestamp ?? "";
}

export function SearchPanel() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [scope, setScope] = useState<SearchScope>("all");
  const [filterImages, setFilterImages] = useState(false);
  const [filterAttachments, setFilterAttachments] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const doSearch = useCallback(async (q: string, s: SearchScope, images: boolean, attachments: boolean) => {
    if (!q.trim() && !images && !attachments) {
      setResults([]);
      setStatus("idle");
      return;
    }

    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus("loading");
    try {
      const params = new URLSearchParams({
        limit: "50",
        offset: "0",
        scope: s,
      });
      if (q.trim()) params.set("q", q.trim());
      if (images) params.set("images", "1");
      if (attachments) params.set("attachments", "1");

      const res = await fetch(`/search?${params.toString()}`, {
        credentials: "same-origin",
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: SearchResponse = await res.json();
      const items: SearchResult[] = data.results ?? data.messages ?? data.items ?? [];
      setResults(items);
      setStatus("done");
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      setResults([]);
      setStatus("error");
    }
  }, []);

  const triggerSearch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      doSearch(query, scope, filterImages, filterAttachments);
    }, 300);
  }, [query, scope, filterImages, filterAttachments, doSearch]);

  const handleInput = (e: Event) => {
    const val = (e.target as HTMLInputElement).value;
    setQuery(val);
  };

  // Re-search when query or filters change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      doSearch(query, scope, filterImages, filterAttachments);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, scope, filterImages, filterAttachments, doSearch]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  const renderBody = () => {
    if (!query.trim() && !filterImages && !filterAttachments) {
      return (
        <div className="search-panel__empty">
          Type to search or select a filter
        </div>
      );
    }
    if (status === "loading") {
      return (
        <div className="search-panel__empty">
          Searching…
        </div>
      );
    }
    if (status === "error") {
      return (
        <div className="search-panel__empty search-panel__empty--error">
          Search failed. Try again.
        </div>
      );
    }
    if (results.length === 0) {
      return (
        <div className="search-panel__empty">
          No results for &ldquo;{query}&rdquo;
        </div>
      );
    }
    return (
      <ul className="search-panel__results">
        {results.map((r) => (
          <li
            key={r.id}
            className="search-panel__item"
            data-message-id={r.id}
            tabIndex={0}
            role="button"
            onClick={() => {
              window.dispatchEvent(new CustomEvent("piclaw:scroll-to-message", { detail: { id: r.id } }));
              window.dispatchEvent(new CustomEvent("piclaw:close-sidebar"));
            }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); window.dispatchEvent(new CustomEvent("piclaw:scroll-to-message", { detail: { id: r.id } })); window.dispatchEvent(new CustomEvent("piclaw:close-sidebar")); } }}
          >
            <div className="search-panel__item-header">
              <span className="search-panel__item-type">{((r as unknown as Record<string, unknown>).data as Record<string, unknown>)?.type === "user_message" ? "You" : "Agent"}</span>
              {getTimestamp(r) && (
                <span className="search-panel__item-time">{formatTime(getTimestamp(r))}</span>
              )}
            </div>
            <span className="search-panel__item-text">{getSnippet(r)}</span>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className="search-panel">
      <div className="search-panel__input-wrapper">
        <span className="search-panel__icon" aria-hidden="true">🔍</span>
        <input
          type="text"
          className="search-panel__input"
          placeholder="Search messages…"
          value={query}
          onInput={handleInput}
          spellcheck={false}
          autocomplete="off"
        />
      </div>

      {/* Filter bar */}
      <div className="search-panel__filters">
        <CustomSelect
          className="search-panel__scope-select"
          options={[
            { value: "current", label: "Current chat" },
            { value: "root", label: "Branch family" },
            { value: "all", label: "All chats" },
          ]}
          value={scope}
          onChange={(v) => setScope(v as SearchScope)}
        />
        <label className="search-panel__filter-toggle">
          <input
            type="checkbox"
            checked={filterImages}
            onChange={(e) => setFilterImages((e.target as HTMLInputElement).checked)}
          />
          <span>Images</span>
        </label>
        <label className="search-panel__filter-toggle">
          <input
            type="checkbox"
            checked={filterAttachments}
            onChange={(e) => setFilterAttachments((e.target as HTMLInputElement).checked)}
          />
          <span>Files</span>
        </label>
      </div>

      {renderBody()}
    </div>
  );
}
