/* =============================================================
   bookUniverse.js
   Builds and manages the Three.js scene: starfield background,
   book-cover meshes that face the camera, orbit controls, raycaster
   for picking, and GSAP-driven transitions between layout modes.
   ============================================================= */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import gsap from "gsap";

/* ---------- Constants ---------------------------------------- */

// Standard book aspect ratio, ~width:height. We scale meshes uniformly
// from this base, but each book's actual texture aspect overrides
// it once loaded so paperbacks and tall hardbacks both look right.
const BOOK_BASE_WIDTH  = 2.0;
const BOOK_BASE_HEIGHT = 3.0;

// Universe scale — affects how spread out the books are.
const UNIVERSE_RADIUS = 60;

// Grayscale fallback color while a cover texture is still loading,
// or if the URL fails entirely.
const PLACEHOLDER_COLOR = 0x1a1d2e;

/* ---------- Helpers ------------------------------------------ */

/**
 * Deterministic pseudo-random in [0, 1) seeded by an integer.
 * Used so positions stay stable between mode switches.
 */
function seededRandom(seed) {
  // Mulberry32
  let t = seed + 0x6d2b79f5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * Even distribution on a sphere using the Fibonacci spiral.
 * Returns array of {x,y,z} in unit-sphere coordinates.
 */
function fibonacciSphere(n) {
  const points = [];
  const phi = Math.PI * (Math.sqrt(5) - 1); // golden angle
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1 || 1)) * 2; // 1 → -1
    const radius = Math.sqrt(1 - y * y);
    const theta = phi * i;
    points.push({
      x: Math.cos(theta) * radius,
      y,
      z: Math.sin(theta) * radius,
    });
  }
  return points;
}

/**
 * Build a procedural fallback texture for a book when its cover URL
 * fails. Generates a colored canvas with the title typeset on it.
 */
function makeFallbackTexture(book) {
  const W = 400, H = 600;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  // Hash title to a hue so each fallback gets a distinct cover color.
  let hash = 0;
  for (const c of book.title) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  const hue = Math.abs(hash) % 360;

  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0,   `hsl(${hue}, 38%, 28%)`);
  grad.addColorStop(1,   `hsl(${(hue + 40) % 360}, 42%, 14%)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Subtle inner border, like a debossed cover edge
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 2;
  ctx.strokeRect(16, 16, W - 32, H - 32);

  // Title — wrapped, centered
  ctx.fillStyle = "rgba(243, 238, 226, 0.95)";
  ctx.font = "500 34px 'Fraunces', Georgia, serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  wrapText(ctx, book.title, W / 2, H / 2 - 40, W - 80, 42);

  // Author
  ctx.fillStyle = "rgba(243, 238, 226, 0.55)";
  ctx.font = "italic 20px 'Fraunces', Georgia, serif";
  const author = (book.authors[0] || "").toString();
  if (author) ctx.fillText(author, W / 2, H - 70);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Word-wrap helper for the fallback canvas. */
function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(/\s+/);
  let line = "";
  const lines = [];
  for (const word of words) {
    const testLine = line ? line + " " + word : word;
    if (ctx.measureText(testLine).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = testLine;
    }
  }
  if (line) lines.push(line);
  const startY = y - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((l, i) => ctx.fillText(l, x, startY + i * lineHeight));
}

/* =============================================================
   Main class
   ============================================================= */

export class BookUniverse {
  /**
   * @param {HTMLElement} container element to mount into
   * @param {object} hooks { onHover(book|null), onClick(book) }
   */
  constructor(container, hooks = {}) {
    this.container = container;
    this.hooks = hooks;
    this.books = [];
    this.meshes = [];          // parallel to this.books
    this.layouts = {};         // mode -> Vector3[] keyed by index
    this.currentMode = "drift";

    // Mouse state for raycasting
    this.pointer = new THREE.Vector2(-2, -2); // off-screen by default
    this.raycaster = new THREE.Raycaster();
    this.hovered = null;

    // Idle drift offsets (per mesh) — tiny phase/amplitude so the
    // universe breathes when the user isn't interacting.
    this.driftPhases = [];

    this._initRenderer();
    this._initScene();
    this._initCamera();
    this._initControls();
    this._initStars();
    this._bindEvents();

    this._tick = this._tick.bind(this);
    this._lastTime = performance.now();
    requestAnimationFrame(this._tick);
  }

  /* ----- Setup ---------------------------------------------- */

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,             // let the CSS starfield show through
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);
    this.container.appendChild(this.renderer.domElement);
  }

  _initScene() {
    this.scene = new THREE.Scene();
    // Light fog gives depth — distant books fade into the background.
    this.scene.fog = new THREE.Fog(0x05060c, UNIVERSE_RADIUS * 1.2, UNIVERSE_RADIUS * 3);
  }

  _initCamera() {
    this.camera = new THREE.PerspectiveCamera(
      55,
      window.innerWidth / window.innerHeight,
      0.1,
      500
    );
    this.camera.position.set(0, 0, UNIVERSE_RADIUS * 1.6);
  }

  _initControls() {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.enablePan = true;
    this.controls.minDistance = 8;
    this.controls.maxDistance = UNIVERSE_RADIUS * 4;
    this.controls.rotateSpeed = 0.55;
    this.controls.zoomSpeed = 0.9;
    this.controls.panSpeed = 0.7;
    // Slow auto-rotate for ambient motion when idle
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.18;
  }

  _initStars() {
    // Two layers of stars: distant (small) and near (larger, brighter).
    this._addStarLayer(2200, 220, 0.08, 0xffffff, 0.6);
    this._addStarLayer(400, 320, 0.18, 0xf4c97b, 0.9);
  }

  _addStarLayer(count, distance, size, color, opacity) {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // Random points on a sphere shell
      const u = Math.random(), v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      const r = distance * (0.85 + 0.3 * Math.random());
      positions[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
    }
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color,
      size,
      sizeAttenuation: true,
      transparent: true,
      opacity,
      depthWrite: false,
      fog: false,
    });
    this.scene.add(new THREE.Points(geo, mat));
  }

  _bindEvents() {
    window.addEventListener("resize", () => this._onResize());

    const dom = this.renderer.domElement;
    dom.addEventListener("pointermove", (e) => this._onPointerMove(e));
    dom.addEventListener("pointerleave", () => {
      this.pointer.set(-2, -2);
      this._setHovered(null);
    });
    dom.addEventListener("click", (e) => this._onClick(e));

    // Pause auto-rotate as soon as the user interacts.
    this.controls.addEventListener("start", () => {
      this.controls.autoRotate = false;
    });
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  _onPointerMove(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    if (this.hooks.onPointerMove) {
      this.hooks.onPointerMove(event.clientX, event.clientY);
    }
  }

  _onClick() {
    if (!this.hovered) return;
    const book = this.hovered.userData.book;
    if (this.hooks.onClick) this.hooks.onClick(book, this.hovered);
  }

  /* ----- Public API ----------------------------------------- */

  /**
   * Populate the universe with books. Builds one textured plane per
   * book, kicks off async cover loading, and computes layouts.
   */
  setBooks(books) {
    this.books = books;
    const loader = new THREE.TextureLoader();
    loader.crossOrigin = "anonymous";

    books.forEach((book, i) => {
      const geometry = new THREE.PlaneGeometry(BOOK_BASE_WIDTH, BOOK_BASE_HEIGHT);
      const material = new THREE.MeshBasicMaterial({
        color: PLACEHOLDER_COLOR,
        transparent: true,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData.book = book;
      mesh.userData.index = i;
      mesh.userData.targetScale = 1; // for hover scaling

      this.scene.add(mesh);
      this.meshes.push(mesh);
      this.driftPhases.push({
        ax: Math.random() * Math.PI * 2,
        ay: Math.random() * Math.PI * 2,
        az: Math.random() * Math.PI * 2,
        speed: 0.3 + Math.random() * 0.5,
      });

      // Kick off cover load. Use procedural fallback on error.
      const url = book.cover;
      const applyTexture = (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        material.map = texture;
        material.color.set(0xffffff);
        material.needsUpdate = true;
        // Fix aspect: preserve real cover proportions
        const img = texture.image;
        if (img && img.width && img.height) {
          const aspect = img.width / img.height;
          // Scale the mesh so the longer edge stays at BOOK_BASE_HEIGHT
          const baseAspect = BOOK_BASE_WIDTH / BOOK_BASE_HEIGHT;
          if (aspect > baseAspect) {
            // Wider than expected — keep height, widen
            mesh.scale.x = aspect / baseAspect;
            mesh.scale.y = 1;
          } else {
            mesh.scale.x = 1;
            mesh.scale.y = baseAspect / aspect;
          }
          mesh.userData.naturalScale = { x: mesh.scale.x, y: mesh.scale.y };
        }
      };

      if (url) {
        loader.load(
          url,
          applyTexture,
          undefined,
          () => applyTexture(makeFallbackTexture(book))
        );
      } else {
        applyTexture(makeFallbackTexture(book));
      }
    });

    this._computeLayouts();
    this._applyLayout(this.currentMode, /* animate */ false);
  }

  /**
   * Switch layout mode with a smooth GSAP transition.
   */
  setMode(mode) {
    if (!this.layouts[mode]) return;
    this.currentMode = mode;
    this._applyLayout(mode, /* animate */ true);
  }

  /**
   * Frame the camera on a specific book mesh — used after click.
   * Returns a GSAP timeline so callers can chain.
   */
  focusOn(mesh) {
    this.controls.autoRotate = false;
    const target = mesh.position.clone();
    // Camera should sit a few units away, on the line from origin
    // through the book (so the cover faces us).
    const direction = target.clone().normalize();
    const camTarget = target.clone().add(direction.multiplyScalar(6));

    return gsap.timeline()
      .to(this.controls.target, {
        x: target.x, y: target.y, z: target.z,
        duration: 1.2, ease: "power3.inOut",
      }, 0)
      .to(this.camera.position, {
        x: camTarget.x, y: camTarget.y, z: camTarget.z,
        duration: 1.2, ease: "power3.inOut",
      }, 0);
  }

  /** Resume gentle auto-rotation. Called when overlay closes. */
  resume() {
    this.controls.autoRotate = true;
  }

  /* ----- Layout computation --------------------------------- */

  _computeLayouts() {
    const n = this.books.length;
    this.layouts.drift = this._driftLayout(n);
    this.layouts.genre = this._clusterLayout(this._groupBy("genres"), n);
    this.layouts.author = this._clusterLayout(this._groupBy("authors"), n);
    this.layouts.year = this._yearLayout(n);
  }

  _driftLayout(n) {
    // Random points distributed in a spherical shell, with a hollow
    // center so the camera has somewhere to sit.
    const positions = [];
    const inner = UNIVERSE_RADIUS * 0.18;
    const outer = UNIVERSE_RADIUS;
    for (let i = 0; i < n; i++) {
      const u = seededRandom(i * 7 + 1);
      const v = seededRandom(i * 13 + 3);
      const w = seededRandom(i * 19 + 5);
      const theta = 2 * Math.PI * u;
      const phi   = Math.acos(2 * v - 1);
      const r     = inner + (outer - inner) * Math.cbrt(w);
      positions.push(new THREE.Vector3(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi)
      ));
    }
    return positions;
  }

  _groupBy(field) {
    // field is "genres" or "authors". Returns Map<string, indices[]>.
    // Books with no value go into "Unknown". Books with multiple
    // values (e.g. several genres) are placed in the FIRST listed.
    const groups = new Map();
    this.books.forEach((b, i) => {
      const arr = b[field];
      const key = (arr && arr[0]) || "—";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(i);
    });
    return groups;
  }

  _clusterLayout(groups, n) {
    // Cluster centers are placed on a Fibonacci sphere so they're
    // evenly spaced. Books within each cluster orbit their center.
    const positions = new Array(n);
    const centers = fibonacciSphere(groups.size);
    let gi = 0;
    for (const [, indices] of groups) {
      const c = centers[gi++];
      const center = new THREE.Vector3(c.x, c.y, c.z)
        .multiplyScalar(UNIVERSE_RADIUS * 0.85);

      // Cluster radius scales with member count so big clusters don't
      // collapse into a dense ball.
      const radius = 4 + Math.sqrt(indices.length) * 1.6;

      indices.forEach((bookIdx, j) => {
        // Distribute members on a small Fibonacci sphere around center
        const local = fibonacciSphere(Math.max(indices.length, 2))[j];
        positions[bookIdx] = new THREE.Vector3(
          center.x + local.x * radius,
          center.y + local.y * radius,
          center.z + local.z * radius
        );
      });
    }
    // Fill any holes (shouldn't happen, but defensive)
    for (let i = 0; i < n; i++) {
      if (!positions[i]) positions[i] = new THREE.Vector3();
    }
    return positions;
  }

  _yearLayout(n) {
    // Sort by year, then arrange along a helix so older books sit at
    // the bottom and newer books at the top — a literal timeline.
    const order = this.books
      .map((b, i) => ({ i, year: Number(b.year) || 0 }))
      .sort((a, b) => a.year - b.year);

    const positions = new Array(n);
    const turns = Math.max(2, n / 20);
    const helixRadius = UNIVERSE_RADIUS * 0.55;
    const helixHeight = UNIVERSE_RADIUS * 1.4;

    order.forEach(({ i }, k) => {
      const t = n > 1 ? k / (n - 1) : 0.5;
      const angle = t * turns * Math.PI * 2;
      positions[i] = new THREE.Vector3(
        Math.cos(angle) * helixRadius,
        (t - 0.5) * helixHeight,
        Math.sin(angle) * helixRadius
      );
    });
    return positions;
  }

  _applyLayout(mode, animate) {
    const targets = this.layouts[mode];
    if (!targets) return;

    this.meshes.forEach((mesh, i) => {
      const t = targets[i];
      // First time through, allocate basePosition. Subsequent layout
      // changes reuse the same Vector3 — we tween its components so
      // the drift loop (which reads from it) sees a smooth transition.
      if (!mesh.userData.basePosition) {
        mesh.userData.basePosition = t.clone();
      }
      if (animate) {
        gsap.to(mesh.userData.basePosition, {
          x: t.x, y: t.y, z: t.z,
          duration: 1.6,
          ease: "power3.inOut",
          delay: (i % 30) * 0.012, // tiny stagger
        });
      } else {
        mesh.userData.basePosition.copy(t);
        mesh.position.copy(t);
      }
    });
  }

  /* ----- Hover handling ------------------------------------- */

  _setHovered(mesh) {
    if (this.hovered === mesh) return;

    // Restore previously hovered mesh
    if (this.hovered) {
      this.hovered.userData.targetScale = 1;
    }
    this.hovered = mesh;
    if (mesh) {
      mesh.userData.targetScale = 1.18;
      document.body.classList.add("is-hovering-book");
      if (this.hooks.onHover) this.hooks.onHover(mesh.userData.book);
    } else {
      document.body.classList.remove("is-hovering-book");
      if (this.hooks.onHover) this.hooks.onHover(null);
    }
  }

  /* ----- Animation loop ------------------------------------- */

  _tick(now) {
    const dt = Math.min(0.05, (now - this._lastTime) / 1000);
    this._lastTime = now;

    this.controls.update();

    // Idle drift — each book wobbles around its base position. Skip
    // the currently-focused-on book so it stays put.
    const t = now / 1000;
    for (let i = 0; i < this.meshes.length; i++) {
      const mesh = this.meshes[i];
      const base = mesh.userData.basePosition;
      if (!base) continue;
      const p = this.driftPhases[i];
      const amp = 0.35;
      mesh.position.x = base.x + Math.sin(t * p.speed + p.ax) * amp;
      mesh.position.y = base.y + Math.cos(t * p.speed + p.ay) * amp;
      mesh.position.z = base.z + Math.sin(t * p.speed + p.az) * amp;

      // Billboard: always face camera
      mesh.lookAt(this.camera.position);

      // Smooth scale toward target (hover effect)
      const natural = mesh.userData.naturalScale || { x: 1, y: 1 };
      const target = mesh.userData.targetScale;
      mesh.scale.x += (natural.x * target - mesh.scale.x) * Math.min(1, dt * 8);
      mesh.scale.y += (natural.y * target - mesh.scale.y) * Math.min(1, dt * 8);
    }

    // Raycast for hover
    if (this.pointer.x > -1.5) {
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hits = this.raycaster.intersectObjects(this.meshes, false);
      this._setHovered(hits.length ? hits[0].object : null);
    }

    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this._tick);
  }
}
