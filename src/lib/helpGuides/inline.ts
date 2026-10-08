export type InlineSegment =
  | { kind: 'text'; value: string }
  | { kind: 'bold'; value: string }
  | { kind: 'em'; value: string }
  | { kind: 'code'; value: string };

const INLINE_PATTERN = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;

/** Splits guide text into typed segments for the React, Markdown, and Word renderers. */
export function parseInline(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(INLINE_PATTERN)) {
    const token = match[0];
    const start = match.index ?? 0;
    if (start > lastIndex) {
      segments.push({ kind: 'text', value: text.slice(lastIndex, start) });
    }
    if (token.startsWith('**')) {
      segments.push({ kind: 'bold', value: token.slice(2, -2) });
    } else if (token.startsWith('`')) {
      segments.push({ kind: 'code', value: token.slice(1, -1) });
    } else {
      segments.push({ kind: 'em', value: token.slice(1, -1) });
    }
    lastIndex = start + token.length;
  }

  if (lastIndex < text.length) {
    segments.push({ kind: 'text', value: text.slice(lastIndex) });
  }

  return segments;
}

export function inlineToPlainText(text: string): string {
  return parseInline(text).map((segment) => segment.value).join('');
}

/** Reports unbalanced markup so guide content errors are caught in tests rather than rendered literally. */
export function findInlineMarkupProblems(text: string): string[] {
  const problems: string[] = [];
  const plain = inlineToPlainText(text);
  if (plain.includes('**')) problems.push(`unbalanced bold markers in: ${text}`);
  if ((text.match(/`/g) || []).length % 2 !== 0) problems.push(`unbalanced code markers in: ${text}`);
  return problems;
}
