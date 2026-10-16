import { AccsynError } from "./error";

export interface DecodedQuery {
  entitytype: string;
  expression?: string;
}

/**
 * Split an accsyn query into an entity type and optional WHERE expression.
 * Mirrors Session._decode_query in the Python API.
 */
export function decodeQuery(query: string): DecodedQuery {
  let isEscaped = false;
  let isAtWhitespace = false;
  const normalized = (query || "").replace(/\t/g, " ").replace(/\n/g, "").trim();
  const parts: string[] = [];
  let idxPartStart = 0;
  let parenthesisDepth = 0;
  for (let idx = 0; idx < normalized.length; idx++) {
    const char = normalized[idx];
    if (char === " ") {
      if (!isEscaped && parenthesisDepth === 0) {
        if (!isAtWhitespace) {
          isAtWhitespace = true;
          if (idxPartStart < idx) {
            parts.push(normalized.slice(idxPartStart, idx));
            idxPartStart = idx + 1;
          }
        }
      }
    } else {
      isAtWhitespace = false;
      if (char === '"') {
        isEscaped = !isEscaped;
      } else if (char === "(" && !isEscaped) {
        parenthesisDepth += 1;
      } else if (char === ")" && !isEscaped) {
        parenthesisDepth -= 1;
      }
    }
  }
  if (idxPartStart < normalized.length) {
    parts.push(normalized.slice(idxPartStart));
  }
  if (!(parts.length === 1 || parts.length >= 3)) {
    throw new AccsynError(
      'Query has invalid syntax; statements can either be single ("<entity>") or with a WHERE statement ("<(sub)entity> WHERE {<entity>.}id=..{ AND ..}")'
    );
  }
  if (parts.length === 1) {
    return { entitytype: parts[0].toLowerCase() };
  }
  if (parts[1].trim().toLowerCase() !== "where") {
    throw new AccsynError(`Invalid query "${query}", should be on the form "<entitytype> where <expression>".`);
  }
  return {
    entitytype: parts[0].toLowerCase(),
    expression: parts.slice(2).join(" ").toLowerCase(),
  };
}
