/**
 * Bicep syntax highlighting mode for CodeMirror StreamLanguage.
 * Reference: Azure/bicep hljs grammar (keyword lists).
 * Pinned ref: Azure/bicep main branch as of 2026-05-02.
 */

// Keep keyword lists at the top for easy upstream sync
const KEYWORDS = new Set([
  "targetScope", "resource", "module", "param", "var", "output", "for", "in",
  "if", "existing", "import", "as", "type", "metadata", "assert", "using",
  "test", "with", "func", "spread", "true", "false", "null",
]);

const TYPES = new Set([
  "string", "int", "bool", "object", "array",
]);

const BUILTINS = new Set([
  "resourceGroup", "subscription", "tenant", "managementGroup",
  "concat", "uniqueString", "format", "toLower", "toUpper",
  "contains", "length", "empty", "first", "last", "split", "join",
  "replace", "trim", "startsWith", "endsWith", "indexOf",
  "base64", "uri", "uriComponent", "dataUri",
  "environment", "reference", "listKeys", "list",
  "json", "union", "intersection",
  "range", "take", "skip", "min", "max", "padLeft",
  "guid", "dateTimeAdd", "utcNow",
  "loadTextContent", "loadFileAsBase64", "loadJsonContent",
  "sys", "az",
]);

interface StreamLike {
  eatSpace(): boolean;
  match(pattern: string | RegExp): string | boolean | null;
  current(): string;
  next(): string | null;
  skipToEnd(): void;
}

export interface StreamState {
  inBlockComment: boolean;
  inMultilineString: boolean;
}

export const bicepMode = {
  startState(): StreamState {
    return { inBlockComment: false, inMultilineString: false };
  },

  token(stream: StreamLike, state: StreamState): string | null {
    // Block comment continuation
    if (state.inBlockComment) {
      if (stream.match(/.*?\*\//)) {
        state.inBlockComment = false;
      } else {
        stream.skipToEnd();
      }
      return "comment";
    }

    // Multi-line string continuation
    if (state.inMultilineString) {
      if (stream.match(/.*?'''/)) {
        state.inMultilineString = false;
      } else {
        stream.skipToEnd();
      }
      return "string";
    }

    // Whitespace
    if (stream.eatSpace()) return null;

    // Line comment
    if (stream.match("//")) {
      stream.skipToEnd();
      return "comment";
    }

    // Block comment start
    if (stream.match("/*")) {
      state.inBlockComment = true;
      if (stream.match(/.*?\*\//)) {
        state.inBlockComment = false;
      } else {
        stream.skipToEnd();
      }
      return "comment";
    }

    // Decorator
    if (stream.match(/@[a-zA-Z_]\w*/)) {
      return "meta";
    }

    // Multi-line string
    if (stream.match("'''")) {
      state.inMultilineString = true;
      if (stream.match(/.*?'''/)) {
        state.inMultilineString = false;
      } else {
        stream.skipToEnd();
      }
      return "string";
    }

    // Single-quoted string (with interpolation markers)
    if (stream.match(/'(?:[^'\\]|\\.)*'/)) {
      return "string";
    }

    // Numbers
    if (stream.match(/\d+/)) {
      return "number";
    }

    // Identifiers and keywords
    if (stream.match(/[a-zA-Z_]\w*/)) {
      const word = stream.current();
      if (KEYWORDS.has(word)) return "keyword";
      if (TYPES.has(word)) return "typeName";
      if (BUILTINS.has(word)) return "variableName2";
      return "variableName";
    }

    // Operators
    if (stream.match(/[=!<>]=?|&&|\|\||[+\-*/%?:!.]/)) {
      return "operator";
    }

    // Brackets and punctuation
    if (stream.match(/[{}()\[\],;]/)) {
      return "punctuation";
    }

    // Advance one char if nothing matched
    stream.next();
    return null;
  },
};
