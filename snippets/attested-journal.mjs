// Excerpt from Outrider (src/lib/attest.mjs). Shown for illustration only.
// The full source code is available at https://store.mikodes.com/p/outrider/
//
// A journal where every row carries a hash of the previous hash plus the row. Editing,
// inserting, removing or reordering a row breaks the chain from that point, so a track
// record can be checked by anyone with the file.

// ATTESTED JOURNAL (fill hash chain): every journal row carries `h` = sha256(previous h + the row). Rows
// cannot be inserted, deleted, reordered or edited afterwards without breaking the chain from that row on, so a paper
// track record can be checked by anyone holding the file. It is evidence, not proof — whoever runs the desk could run
// modified code — but it makes quiet after-the-fact edits (a deleted loser, a backdated winner) detectable.
import crypto from "node:crypto";

export const GENESIS = "0".repeat(64);

/** The chained hash of one row (the row WITHOUT its own `h`), as the exact JSON text that is written. */
export function chainHash(prev, rowJson) {
  return crypto.createHash("sha256").update(prev).update("\n").update(rowJson).digest("hex");
}

/**
 * Verify a journal's chain from its JSONL text lines. Rows written before attestation existed (no `h`) are an
 * unattested prefix and are counted, not judged; after the first attested row every row must carry a valid `h`.
 * @returns { ok, rows, attested, torn, unattestedPrefix, brokenAt?, reason?, head }
 */
export function verifyLines(lines) {
  let prev = GENESIS;
  let attested = 0,
    prefix = 0,
    rows = 0,
    torn = 0,
    started = false;
  for (const [i, line] of lines.entries()) {
    if (!line) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      // A row torn by a crash mid-append never became the chain head (the next row chains from the one before it), so
      // skipping it keeps the check sound: damaging a COMPLETE row still breaks the next row's hash.
      torn++;
      continue;
    }
    rows++;
    if (!row || typeof row !== "object" || typeof row.h !== "string") {
      if (started)
        return {
          ok: false,
          rows,
          attested,
          torn,
          unattestedPrefix: prefix,
          brokenAt: i + 1,
          reason: "row without hash after the chain started",
          head: prev,
        };
      prefix++;
      continue;
    }
    started = true;
    const { h, ...rest } = row;
    const want = chainHash(prev, JSON.stringify(rest));
    if (h !== want)
      return {
        ok: false,
        rows,
        attested,
        torn,
        unattestedPrefix: prefix,
        brokenAt: i + 1,
        reason: "hash mismatch (row edited, inserted, removed or reordered)",
        head: prev,
      };
    prev = h;
    attested++;
  }
  return { ok: true, rows, attested, torn, unattestedPrefix: prefix, head: prev };
}
