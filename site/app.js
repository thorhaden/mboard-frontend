// Base URL of the API. Deployed, it's "" (same origin): CloudFront serves the API under /api/*.
// When the page is served locally (make serve), the API runs separately on local uvicorn.
const API = ["localhost", "127.0.0.1"].includes(location.hostname) ? "http://localhost:8000" : "";

// What the API accepts for an attached image. S3 enforces the same limits on the upload.
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
// The sizes the resize function serves: each fits the image in a size × size box. Few sizes, so
// CloudFront caches only a few variants of each image whatever the visitors' screens.
const THUMB_SIZE = 140;
const LARGE_SIZES = [480, 960, 1920];
// The large view's image may use up to this share of the window, leaving room for the message below.
const VIEWER_MAX_WIDTH = 0.9;
const VIEWER_MAX_HEIGHT = 0.7;

const form = document.getElementById("post-form");
const nameInput = document.getElementById("name");
const textInput = document.getElementById("text");
const imageInput = document.getElementById("image");
const statusEl = document.getElementById("status");
const list = document.getElementById("messages");
const olderBtn = document.getElementById("older");
const refreshBtn = document.getElementById("refresh");
const viewer = document.getElementById("viewer");
const viewerLink = document.getElementById("viewer-link");
const viewerImg = document.getElementById("viewer-img");
const viewerMeta = document.getElementById("viewer-meta");
const viewerText = document.getElementById("viewer-text");

let nextCursor = null;

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("error", isError);
}

const imageUrl = (id, size) => `${API}/api/images/${id}/${size}`;
const originalUrl = (id) => `${API}/images/${id}`;

function renderMeta(el, m) {
  const who = document.createElement("strong");
  who.textContent = m.name;
  el.replaceChildren(who, " · " + new Date(m.created_at).toLocaleString());
}

// Messages are user input: build DOM nodes with textContent, never innerHTML.
function renderMessage(m) {
  const li = document.createElement("li");
  const body = document.createElement("div");
  body.className = "body";
  const meta = document.createElement("div");
  meta.className = "meta";
  renderMeta(meta, m);
  const text = document.createElement("p");
  text.className = "text";
  text.textContent = m.text;
  body.append(meta, text);
  li.append(body);

  if (m.image_id) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "thumb";
    button.title = "Show larger";
    const img = document.createElement("img");
    img.src = imageUrl(m.image_id, THUMB_SIZE);
    img.alt = `Image from ${m.name}`;
    img.loading = "lazy";
    button.append(img);
    button.addEventListener("click", () => openViewer(m, img));
    li.append(button);
  }
  return li;
}

// Scale w × h to fit inside maxW × maxH, keeping the aspect ratio. Scales up as well as down.
function fit(w, h, maxW, maxH) {
  const scale = Math.min(maxW / w, maxH / h);
  return [Math.round(w * scale), Math.round(h * scale)];
}

function openViewer(m, thumb) {
  const boxW = innerWidth * VIEWER_MAX_WIDTH;
  const boxH = innerHeight * VIEWER_MAX_HEIGHT;
  // The thumbnail has the original's aspect ratio, so it tells how large the image will be shown.
  // Without it (still loading, or failed), assume the image fills the box.
  const [w, h] = thumb.naturalWidth ? fit(thumb.naturalWidth, thumb.naturalHeight, boxW, boxH) : [boxW, boxH];
  // Physical pixels needed along the long edge; the smallest size with that many, or the largest one.
  const needed = Math.max(w, h) * devicePixelRatio;
  const size = LARGE_SIZES.find((s) => s >= needed) ?? LARGE_SIZES.at(-1);

  // Show the thumbnail scaled up right away, then swap in the larger image once it has loaded.
  viewerImg.src = thumb.src;
  viewerImg.alt = thumb.alt;
  setViewerSize(w, h);
  const large = new Image();
  large.onload = () => {
    if (viewerImg.dataset.id !== m.image_id) return; // closed, or another image opened meanwhile
    viewerImg.src = large.src;
    // A small original is never scaled up past its own size, so it isn't shown blurry.
    const [fw, fh] = fit(large.naturalWidth, large.naturalHeight, boxW, boxH);
    setViewerSize(Math.min(fw, large.naturalWidth), Math.min(fh, large.naturalHeight));
  };
  viewerImg.dataset.id = m.image_id;
  large.src = imageUrl(m.image_id, size);

  viewerLink.href = originalUrl(m.image_id);
  renderMeta(viewerMeta, m);
  viewerText.textContent = m.text;
  viewer.showModal();
}

function setViewerSize(w, h) {
  viewerImg.style.width = `${w}px`;
  viewerImg.style.height = `${h}px`;
}

viewer.addEventListener("close", () => {
  delete viewerImg.dataset.id;
  viewerImg.removeAttribute("src");
});
// A click on the backdrop lands on the dialog element itself; close then, like Esc does.
viewer.addEventListener("click", (e) => {
  if (e.target === viewer) viewer.close();
});

async function load({ append = false } = {}) {
  // Base is needed when API is "" (same origin behind CloudFront).
  const url = new URL(API + "/api/messages", location.href);
  if (append && nextCursor) url.searchParams.set("cursor", nextCursor);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    if (!append) list.replaceChildren();
    list.append(...body.messages.map(renderMessage));
    nextCursor = body.next_cursor;
    olderBtn.hidden = !nextCursor;
    if (!append && body.messages.length === 0) setStatus("No messages yet. Be the first!");
  } catch (err) {
    setStatus(`Could not load messages (${err.message})`, true);
  }
}

// Uploads the file straight to S3 with a presigned POST from the API, and returns its image_id.
async function uploadImage(file) {
  const res = await fetch(API + "/api/uploads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content_type: file.type }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const upload = await res.json();

  const data = new FormData();
  for (const [key, value] of Object.entries(upload.fields)) data.append(key, value);
  data.append("file", file); // S3 ignores any fields after the file
  const s3res = await fetch(upload.url, { method: "POST", body: data });
  if (!s3res.ok) throw new Error(`upload failed, HTTP ${s3res.status}`);
  return upload.image_id;
}

// Checked here for a clear message; S3 refuses anything else anyway.
function imageProblem(file) {
  if (!IMAGE_TYPES.includes(file.type)) return "The image must be a JPEG, PNG, WebP or GIF.";
  if (file.size > MAX_IMAGE_BYTES) return "The image is larger than 10 MB.";
  return null;
}

imageInput.addEventListener("change", () => {
  const file = imageInput.files[0];
  const problem = file && imageProblem(file);
  imageInput.setCustomValidity(problem || "");
  setStatus(problem || "", Boolean(problem));
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    let imageId = null;
    const file = imageInput.files[0];
    if (file) {
      setStatus("Uploading image…");
      imageId = await uploadImage(file);
    }
    setStatus("Posting…");
    const res = await fetch(API + "/api/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: nameInput.value, text: textInput.value, image_id: imageId }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    try { localStorage.setItem("mboard-name", nameInput.value); } catch {}
    textInput.value = "";
    imageInput.value = "";
    setStatus("");
    await load();
  } catch (err) {
    setStatus(`Could not post (${err.message})`, true);
  } finally {
    button.disabled = false;
  }
});

olderBtn.addEventListener("click", () => load({ append: true }));
refreshBtn.addEventListener("click", () => load());

try { nameInput.value = localStorage.getItem("mboard-name") || ""; } catch {}
load();
