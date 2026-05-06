/* =============================================================
   overlay.js
   Manages the book detail overlay: populating its DOM, animating
   it in/out with GSAP, handling close gestures.
   ============================================================= */

import gsap from "gsap";

const els = {
  root:        document.getElementById("overlay"),
  closeBtn:    document.getElementById("overlay-close"),
  panel:       null,
  cover:       document.getElementById("overlay-cover"),
  year:        document.getElementById("overlay-year"),
  title:       document.getElementById("overlay-title"),
  author:      document.getElementById("overlay-author"),
  meta:        document.getElementById("overlay-meta"),
  tags:        document.getElementById("overlay-tags"),
  description: document.getElementById("overlay-description"),
};
els.panel = els.root.querySelector(".overlay__panel");

let _onClose = null;

/** Format a description string into paragraphs. */
function paragraphize(text) {
  return text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, " ").trim())
    .filter(Boolean);
}

/** Build a meta item element. */
function metaItem(label, value) {
  const wrap = document.createElement("div");
  wrap.className = "overlay__meta-item";
  const l = document.createElement("span");
  l.className = "overlay__meta-label";
  l.textContent = label;
  const v = document.createElement("span");
  v.className = "overlay__meta-value";
  v.textContent = value;
  wrap.append(l, v);
  return wrap;
}

/** Populate the overlay DOM with a book's data. */
function fill(book) {
  els.cover.src = book.cover || "";
  els.cover.alt = `${book.title} cover`;

  els.year.textContent = book.year ? String(book.year) : "";
  els.title.textContent = book.title;
  els.author.textContent = book.authors.length
    ? "by " + book.authors.join(", ")
    : "";

  // Meta strip
  els.meta.innerHTML = "";
  if (book.year)            els.meta.appendChild(metaItem("Year",    book.year));
  if (book.pages)           els.meta.appendChild(metaItem("Pages",   book.pages));
  if (book.rating)          els.meta.appendChild(metaItem("Rating",  Number(book.rating).toFixed(2)));
  if (book.language)        els.meta.appendChild(metaItem("Language", book.language));

  // Tags — combine genres + categories, dedupe, cap at 8
  const tagSet = new Set([...(book.genres || []), ...(book.categories || [])]);
  els.tags.innerHTML = "";
  [...tagSet].slice(0, 8).forEach((t) => {
    const el = document.createElement("span");
    el.className = "tag";
    el.textContent = t;
    els.tags.appendChild(el);
  });

  // Description
  els.description.innerHTML = "";
  paragraphize(book.description || "").forEach((p) => {
    const para = document.createElement("p");
    para.textContent = p;
    els.description.appendChild(para);
  });
}

/* ---------- Public API --------------------------------------- */

/**
 * Open the overlay for a book. Returns the GSAP timeline so the
 * caller can await it if needed.
 */
export function openOverlay(book) {
  fill(book);
  els.root.classList.add("is-open");
  els.root.setAttribute("aria-hidden", "false");
  els.root.style.pointerEvents = "auto";

  return gsap.timeline()
    .fromTo(els.root,
      { backgroundColor: "rgba(2, 3, 8, 0)", backdropFilter: "blur(0px)" },
      { backgroundColor: "rgba(2, 3, 8, 0.55)", backdropFilter: "blur(8px)",
        duration: 0.5, ease: "power2.out" }, 0)
    .fromTo(els.panel,
      { opacity: 0, y: 20, scale: 0.98 },
      { opacity: 1, y: 0, scale: 1, duration: 0.55, ease: "power3.out" }, 0.05);
}

/** Close the overlay with the reverse animation. */
export function closeOverlay() {
  return gsap.timeline({
    onComplete: () => {
      els.root.classList.remove("is-open");
      els.root.setAttribute("aria-hidden", "true");
      if (_onClose) _onClose();
    },
  })
    .to(els.panel,
      { opacity: 0, y: 12, scale: 0.98, duration: 0.3, ease: "power2.in" }, 0)
    .to(els.root,
      { backgroundColor: "rgba(2, 3, 8, 0)", backdropFilter: "blur(0px)",
        duration: 0.35, ease: "power2.in" }, 0);
}

/** Register a callback to fire after the overlay finishes closing. */
export function onClose(fn) { _onClose = fn; }

/* ---------- Wire up close gestures --------------------------- */

els.closeBtn.addEventListener("click", closeOverlay);

// Click on the dim backdrop (but not the panel) closes too
els.root.addEventListener("click", (e) => {
  if (e.target === els.root) closeOverlay();
});

// Escape key closes
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && els.root.classList.contains("is-open")) {
    closeOverlay();
  }
});
