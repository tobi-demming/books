/* =============================================================
   main.js
   Orchestrates the app: load books, build the universe, wire up
   HUD buttons and tooltip, hand clicks to the overlay.
   ============================================================= */

import { loadBooks } from "./bookLoader.js";
import { BookUniverse } from "./bookUniverse.js";
import { openOverlay, closeOverlay, onClose } from "./overlay.js";

const stage     = document.getElementById("stage");
const loader    = document.getElementById("loader");
const tooltip   = document.getElementById("tooltip");
const counter   = document.getElementById("book-count");
const modeBtns  = document.querySelectorAll(".mode");

let universe;
let lastFocusedMesh = null;

/* ---------- Tooltip helpers ---------------------------------- */

const tipTitle  = tooltip.querySelector(".tooltip__title");
const tipAuthor = tooltip.querySelector(".tooltip__author");
let lastPointer = { x: 0, y: 0 };

function moveTooltip(x, y) {
  lastPointer = { x, y };
  // Offset away from cursor; flip sides near edges so it stays on-screen
  const W = window.innerWidth, H = window.innerHeight;
  const offX = x > W - 280 ? -260 : 18;
  const offY = y > H - 80  ? -40  : 18;
  tooltip.style.transform = `translate(${x + offX}px, ${y + offY}px)`;
}

function showTooltip(book) {
  if (!book) {
    tooltip.classList.remove("is-visible");
    return;
  }
  tipTitle.textContent  = book.title;
  tipAuthor.textContent = book.authors.join(", ");
  tooltip.classList.add("is-visible");
  moveTooltip(lastPointer.x, lastPointer.y);
}

/* ---------- Boot --------------------------------------------- */

async function boot() {
  let books = [];
  try {
    books = await loadBooks();
  } catch (err) {
    console.error(err);
    loader.querySelector(".loader__text").textContent =
      "Couldn't load library. Check books/index.json.";
    return;
  }

  if (!books.length) {
    loader.querySelector(".loader__text").textContent = "No books found.";
    return;
  }

  universe = new BookUniverse(stage, {
    onHover: (book) => showTooltip(book),
    onPointerMove: (x, y) => moveTooltip(x, y),
    onClick: (book, mesh) => {
      lastFocusedMesh = mesh;
      universe.focusOn(mesh);
      openOverlay(book);
    },
  });
  universe.setBooks(books);

  // When the overlay finishes closing, gently resume the universe's
  // ambient motion. Don't snap the camera back — the user might want
  // to keep exploring from where they are.
  onClose(() => universe.resume());

  counter.textContent = books.length.toString().padStart(2, "0");

  // Hide loader. Slight delay so the first frame and a few covers
  // have time to render in — feels less abrupt than instant.
  setTimeout(() => loader.classList.add("is-hidden"), 600);
}

/* ---------- Mode switcher ------------------------------------ */

modeBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!universe) return;
    const mode = btn.dataset.mode;
    modeBtns.forEach((b) => b.classList.toggle("is-active", b === btn));
    universe.setMode(mode);
  });
});

boot();
