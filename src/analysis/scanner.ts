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

/**
 * The characters Dyalog allows in a name, as one authoritative set.
 *
 * From "Legal Names" in Dyalog's programming reference guide
 * (Dyalog/documentation, programming-reference-guide/docs/introduction/names.md):
 * a name is any sequence of these characters starting with a non-numeric one.
 *
 *   A-Z_  a-z  0-9  ∆⍙
 *   ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝß
 *   àáâãäåæçèéêëìíîïðñòóôõöøùúûüþ
 *   Ⓐ-Ⓩ  (the circled alphabet)
 *
 * The accented ranges are deliberately discontinuous. U+00D7 (×) sits between
 * Ö and Ø, and U+00F7 (÷) between ö and ø; both are primitives, not letters, so
 * a naive À-ÿ range would wrongly swallow them. ý (U+00FD) is likewise absent
 * from Dyalog's table, which lists ùúûüþ. RIDE's own character class in
 * src/syntax_info.js — 'A-Z_a-zÀ-ÖØ-Ýß-öø-üþ∆⍙Ⓐ-Ⓩ' — agrees exactly, which is
 * a useful second source.
 *
 * Everything that needs to recognise a name reads these, so the set is defined
 * once rather than spelled out in six regexes that can drift apart.
 */
const NAME_ACCENTED = 'À-ÖØ-Ýß-öø-üþ';
const NAME_CIRCLED = 'Ⓐ-Ⓩ';

/** Characters legal anywhere in a name except the first position. */
export const NAME_CHARS = `A-Za-z0-9_∆⍙${NAME_ACCENTED}${NAME_CIRCLED}`;

/** Characters legal as the first character: the above without digits. */
export const NAME_FIRST_CHARS = `A-Za-z_∆⍙${NAME_ACCENTED}${NAME_CIRCLED}`;

/** A complete name. */
export const NAME_PATTERN = `[${NAME_FIRST_CHARS}][${NAME_CHARS}]*`;

/** Whether a string is a legal Dyalog name in its entirety. */
export function isLegalName(name: string): boolean {
  return new RegExp(`^${NAME_PATTERN}$`, 'u').test(name);
}
