/* =============================================================
   bookLoader.js
   Fetches the manifest, loads every markdown file listed in it,
   parses the YAML frontmatter, cleans up Obsidian-style wikilinks,
   and returns an array of normalized book records.
   ============================================================= */

import jsyaml from "js-yaml";

const MANIFEST_URL = "books/index.json";

/**
 * Strip Obsidian wikilink syntax: "[[Foo]]" -> "Foo".
 * Recurses into arrays so genres / tags work as expected.
 */
function unwrapWikilinks(value) {
  if (typeof value === "string") {
    return value.replace(/^\[\[(.+)\]\]$/, "$1").trim();
  }
  if (Array.isArray(value)) {
    return value.map(unwrapWikilinks);
  }
  return value;
}

/**
 * Coerce a frontmatter value to a string array. Frontmatter often has
 * single values that should be treated as one-element lists.
 */
function toArray(value) {
  if (value == null || value === "") return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Parse a single markdown file's text into a normalized book record.
 * Returns null if the frontmatter is malformed.
 */
function parseMarkdown(text, sourcePath) {
  // Frontmatter blocks start with --- on their own line and end the same way.
  // Tolerate Windows line endings.
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    console.warn(`[bookLoader] No frontmatter in ${sourcePath}; skipping.`);
    return null;
  }

  let raw;
  try {
    raw = jsyaml.load(match[1]) || {};
  } catch (err) {
    console.warn(`[bookLoader] YAML parse failed in ${sourcePath}:`, err);
    return null;
  }

  // Clean wikilinks across all values
  for (const key of Object.keys(raw)) {
    raw[key] = unwrapWikilinks(raw[key]);
  }

  return {
    id:          sourcePath,
    title:       raw.title || "Untitled",
    authors:     toArray(raw.author),
    genres:      toArray(raw.genre),
    categories:  toArray(raw.categories),
    tags:        toArray(raw.tags),
    year:        raw.year ?? null,
    pages:       raw.pages ?? null,
    rating:      raw.scoreGr ?? raw.rating ?? null,
    cover:       raw.cover || null,
    isbn:        raw.isbn ?? null,
    language:    raw.language ?? null,
    description: (match[2] || "").trim(),
    raw,
  };
}

/**
 * Load every book listed in the manifest.
 * @returns {Promise<Book[]>}
 */
export async function loadBooks() {
  const manifestRes = await fetch(MANIFEST_URL, { cache: "no-store" });
  if (!manifestRes.ok) {
    throw new Error(`Could not fetch ${MANIFEST_URL} (${manifestRes.status})`);
  }
  const manifest = await manifestRes.json();
  if (!Array.isArray(manifest.books)) {
    throw new Error(`${MANIFEST_URL} must contain a "books" array.`);
  }

  // Fetch in parallel, but tolerate individual failures.
  const results = await Promise.allSettled(
    manifest.books.map(async (filename) => {
      const path = `books/${filename}`;
      const res = await fetch(path, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
      const text = await res.text();
      return parseMarkdown(text, filename);
    })
  );

  const books = [];
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) books.push(r.value);
    else if (r.status === "rejected") console.warn("[bookLoader]", r.reason);
  }
  return books;
}
