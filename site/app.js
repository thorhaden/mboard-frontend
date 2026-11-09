// Base URL of the API. Deployed, it's "" (same origin): CloudFront serves the API under /api/*.
// When the page is served locally (make serve), the API runs separately on local uvicorn.
const API = ["localhost", "127.0.0.1"].includes(location.hostname) ? "http://localhost:8000" : "";

const form = document.getElementById("post-form");
const nameInput = document.getElementById("name");
const textInput = document.getElementById("text");
const statusEl = document.getElementById("status");
const list = document.getElementById("messages");
const olderBtn = document.getElementById("older");
const refreshBtn = document.getElementById("refresh");

let nextCursor = null;

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("error", isError);
}

// Messages are user input: build DOM nodes with textContent, never innerHTML.
function renderMessage(m) {
  const li = document.createElement("li");
  const meta = document.createElement("div");
  meta.className = "meta";
  const who = document.createElement("strong");
  who.textContent = m.name;
  meta.append(who, " · " + new Date(m.created_at).toLocaleString());
  const text = document.createElement("p");
  text.className = "text";
  text.textContent = m.text;
  li.append(meta, text);
  return li;
}

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

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = form.querySelector("button");
  button.disabled = true;
  setStatus("Posting…");
  try {
    const res = await fetch(API + "/api/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: nameInput.value, text: textInput.value }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    try { localStorage.setItem("mboard-name", nameInput.value); } catch {}
    textInput.value = "";
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
