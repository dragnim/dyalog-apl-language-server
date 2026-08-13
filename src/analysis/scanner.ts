/**
 * Lexical scanning shared by everything that needs to read APL source without
 * being fooled by comments and character literals.
 *
 * The one job here is masking. Each line is returned alongside a `code` string
 * of exactly the same length, in which every character belonging to a comment
 * or a character literal has been replaced by a space. Positions are therefore
 * preserved, so a consumer can find a construct in `code` and report the column
 * straight back to the editor.
 *
 * That is what stops `x←'}'` and `⍝ }` from closing a dfn, and what stops a
 * bracket inside a string from being reported as unbalanced.
 *
 * Character literals cannot span lines in APL, so an unterminated one is a
 * property of a single line and is reported as such.
 */

export interface ScannedLine {
  /** The line exactly as it appears in the document. */
  text: string;
  /** Same length as `text`, with comments and literals blanked out. */
  code: string;
  /** Column at which an unterminated character literal begins, or -1. */
  unterminatedStringAt: number;
}

/** Splits on all three line endings, matching what the editor will have sent. */
export function splitLines(source: string): string[] {
  return source.split(/\r\n|\r|\n/);
}

/**
 * Masks one line. The doubled-quote escape is handled: in `'don''t'` the middle
 * pair is part of the literal and does not end it.
 */
export function scanLine(text: string): ScannedLine {
  const code: string[] = new Array(text.length).fill(' ');
  let inString = false;
  let stringStart = -1;

  for (let col = 0; col < text.length; col++) {
    const char = text[col];

    if (inString) {
      if (char === "'") {
        if (text[col + 1] === "'") {
          col++; // an escaped quote, still inside the literal
        } else {
          inString = false;
          stringStart = -1;
        }
      }
      continue;
    }

    if (char === '⍝') break; // the rest of the line is a comment

    if (char === "'") {
      inString = true;
      stringStart = col;
      continue;
    }

    code[col] = char;
  }

  return { text, code: code.join(''), unterminatedStringAt: inString ? stringStart : -1 };
}

/** Masks a whole document, one entry per line. */
export function scanLines(source: string): ScannedLine[] {
  return splitLines(source).map(scanLine);
}

/** Name characters as Dyalog defines them, including ∆ and ⍙. */
export const NAME_PATTERN = '[A-Za-z_∆⍙][A-Za-z0-9_∆⍙]*';
