// game.js

import { db } from "./firebase-init.js";
import { getPlayer } from "./player.js";
import { checkGuess } from "./jikan.js";
import { TOTAL_CLUES } from "./clues.js";
import { pickRandomAnimeId } from "./anime-ids.js";
import { fetchEnrichedAnime } from "./jikan.js";
import { buildClueValues } from "./clues.js";
import {
  doc, getDoc, updateDoc, addDoc, collection,
  onSnapshot, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const ROUND_DURATION = 15;   // flat 15 s every round
const SD_TIMER       = 15;   // sudden death same pace
const RING_CIRCUMFERENCE = 213.6;

const player   = getPlayer();
const params   = new URLSearchParams(window.location.search);
const roomCode = params.get("room");
if (!roomCode) { window.location.href = "index.html"; }

const roomRef = doc(db, "rooms", roomCode);

// ── DOM ──
const roundNumEl    = document.getElementById("round-num");
const timerTextEl   = document.getElementById("timer-text");
const ringFillEl    = document.getElementById("ring-fill");
const timerWrap     = document.querySelector(".timer-ring-wrap");
const sdBadge       = document.getElementById("sd-badge");
const cluesList     = document.getElementById("clues-list");
const clueCountEl   = document.getElementById("clue-count");
const guessInput    = document.getElementById("guess-input");
const guessBtn      = document.getElementById("guess-btn");
const guessFeedback = document.getElementById("guess-feedback");
const guessHistory  = document.getElementById("guess-history");
const hudMyName     = document.getElementById("hud-my-name");
const hudOppName    = document.getElementById("hud-opp-name");
const resultOverlay = document.getElementById("result-overlay");
const resultIcon    = document.getElementById("result-icon");
const resultTitle   = document.getElementById("result-title");
const resultAnime   = document.getElementById("result-anime-title");
const resultImg     = document.getElementById("result-anime-img");
const playAgainBtn  = document.getElementById("play-again-btn");
const backLobbyBtn  = document.getElementById("back-lobby-btn");
const dcOverlay     = document.getElementById("disconnect-overlay");
const dcLobbyBtn    = document.getElementById("dc-lobby-btn");

// ── State ──
let roomData             = null;
let timerInterval        = null;
let lastRevealedCount    = 0;
let lastTimerEndsAt      = null;
let amHost               = false;
let guessLocked          = false;
let gameOver             = false;
let iWantRematch         = false;   // did I press Play Again?
let seenRematchVersion   = 0;       // tracks rematchVersion to detect resets
let rematchResetInFlight = false;   // prevents host from firing reset twice

hudMyName.textContent = player.name.toUpperCase();

// ── Init ──
async function init() {
  const snap = await getDoc(roomRef);
  if (!snap.exists()) { window.location.href = "index.html"; return; }

  roomData = snap.data();
  amHost   = roomData.hostId === player.uid;

  const oppName = amHost ? roomData.guestName : roomData.hostName;
  hudOppName.textContent = (oppName || "OPPONENT").toUpperCase();

  seenRematchVersion = roomData.rematchVersion ?? 0;

  renderRevealedClues(roomData.revealedClueCount || 0);

  if (amHost && roomData.round === 0) {
    await startNextRound(1);
  }

  onSnapshot(roomRef, handleRoomUpdate);
  onSnapshot(collection(db, "rooms", roomCode, "guesses"), handleGuessUpdate);
}

// ── Room update handler ──
function handleRoomUpdate(snap) {
  if (!snap.exists()) { if (!gameOver) showDisconnect(); return; }

  const data = snap.data();
  roomData = data;

  if (data.status === "disconnected" && !gameOver) { showDisconnect(); return; }

  // ── Rematch: version bump means host finished resetting → reload cleanly ──
  const incomingVersion = data.rematchVersion ?? 0;
  if (incomingVersion > seenRematchVersion) {
    rematchResetInFlight = true;  // suppress beforeunload disconnect on both sides
    window.location.reload();
    return;
  }

  // ── Rematch: both players ready → host triggers the reset ──
  if (gameOver && data.rematchReady && !rematchResetInFlight) {
    const { hostReady, guestReady } = data.rematchReady;
    if (hostReady && guestReady && amHost) {
      rematchResetInFlight = true;
      resetRoomForRematch();  // async; will bump rematchVersion which triggers reload above
      return;
    }
    updateRematchButtonState(data.rematchReady);
  }

  if ((data.winner || data.draw) && !gameOver) {
    gameOver = true;
    clearTimerInterval();
    showResult(data);
    return;
  }

  if (data.round > 0) roundNumEl.textContent = data.round;

  if (data.revealedClueCount > lastRevealedCount) {
    const newClues = data.clueValues.slice(lastRevealedCount, data.revealedClueCount);
    newClues.forEach((clue, i) => renderClueItem(clue, i === newClues.length - 1));
    lastRevealedCount = data.revealedClueCount;
    clueCountEl.textContent = `${data.revealedClueCount} / ${TOTAL_CLUES}`;
  }

  if (data.suddenDeath) {
    sdBadge.classList.remove("hidden");
    guessInput.placeholder = "Sudden death — type the title...";
  }

  // Only restart countdown when timerEndsAt actually changes
  if (data.timerEndsAt) {
    const endsAtMs = data.timerEndsAt.toMillis?.() ?? data.timerEndsAt;
    if (endsAtMs !== lastTimerEndsAt) {
      lastTimerEndsAt = endsAtMs;
      startCountdown(endsAtMs, data.suddenDeath);
    }
  }

  guessLocked = false;
  guessInput.disabled = false;
  guessBtn.disabled = false;
}

// ── Guess update handler ──
function handleGuessUpdate(snap) {
  const currentVersion = seenRematchVersion;
  snap.docChanges().forEach(change => {
    if (change.type === "added") {
      const g = change.doc.data();
      // Ignore guesses from previous games in this room
      if ((g.rematchVersion ?? 0) !== currentVersion) return;
      const isMe = g.uid === player.uid;
      addGuessToHistory(g.guess, isMe);
    }
  });
}

// ── Round advancement ──
async function startNextRound(roundNum) {
  const isSuddenDeath = roundNum > TOTAL_CLUES;
  const timerSecs     = isSuddenDeath ? SD_TIMER : ROUND_DURATION;
  const newClueCount  = Math.min(roundNum, TOTAL_CLUES);
  const endsAt        = Date.now() + timerSecs * 1000;

  await updateDoc(roomRef, {
    round:             roundNum,
    timerEndsAt:       Timestamp.fromMillis(endsAt),
    revealedClueCount: newClueCount,
    suddenDeath:       isSuddenDeath,
    status:            "in_progress"
  });
}

// ── Timer ──
// totalSecs is always deterministic now (flat 15s), so both players compute the
// same denominator and the ring fill is accurate for everyone.
function startCountdown(endsAtMs, suddenDeath) {
  clearTimerInterval();
  const totalSecs = suddenDeath ? SD_TIMER : ROUND_DURATION;

  timerInterval = setInterval(async () => {
    const remaining = Math.max(0, Math.ceil((endsAtMs - Date.now()) / 1000));
    const progress  = remaining / totalSecs;

    ringFillEl.style.strokeDashoffset = RING_CIRCUMFERENCE * (1 - progress);
    timerTextEl.textContent = remaining;

    timerWrap.classList.remove("timer-low", "timer-critical");
    if (remaining <= 5)       timerWrap.classList.add("timer-critical");
    else if (remaining <= 10) timerWrap.classList.add("timer-low");

    if (remaining <= 0) {
      clearTimerInterval();
      if (!amHost || gameOver) return;

      guessLocked = true;

      const snap = await getDoc(roomRef);
      const d    = snap.data();
      if (d?.winner || d?.draw) return; // someone guessed just in time

      if (suddenDeath) {
        await updateDoc(roomRef, { draw: true, status: "finished" });
        scheduleRoomCleanup();
      } else {
        const nextRound = (d?.round ?? roomData?.round) + 1;
        await startNextRound(nextRound);
      }
    }
  }, 250);
}

function clearTimerInterval() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

// ── Guessing ──
guessBtn.addEventListener("click", submitGuess);
guessInput.addEventListener("keydown", (e) => { if (e.key === "Enter") submitGuess(); });

async function submitGuess() {
  const guess = guessInput.value.trim();
  if (!guess || guessLocked || gameOver) return;

  guessInput.value = "";
  closeSuggestions();
  guessLocked = true;
  guessInput.disabled = true;
  guessBtn.disabled = true;

  const correct = checkGuess(guess, buildAnimeProxy());

  await addDoc(collection(db, "rooms", roomCode, "guesses"), {
    uid:            player.uid,
    name:           player.name,
    guess,
    round:          roomData.round,
    correct,
    rematchVersion: roomData.rematchVersion ?? 0,
    timestamp:      serverTimestamp()
  });

  if (correct) {
    await updateDoc(roomRef, {
      winner:     player.uid,
      winnerName: player.name,
      status:     "finished"
    });
    scheduleRoomCleanup();
  } else {
    showWrongFeedback(guess);
    setTimeout(() => {
      if (!gameOver) {
        guessLocked = false;
        guessInput.disabled = false;
        guessBtn.disabled = false;
        guessInput.focus();
      }
    }, 800);
  }
}

function buildAnimeProxy() {
  return {
    title:          roomData.animeTitle,
    title_english:  roomData.animeTitleEnglish  || "",
    title_japanese: roomData.animeTitleJapanese || "",
    titles:         roomData.animeTitles        || []
  };
}

// ── Autocomplete ──
let acTimeout = null;
let acCache   = {};

guessInput.addEventListener("input", () => {
  const q = guessInput.value.trim();
  closeSuggestions();
  if (q.length < 2) return;
  clearTimeout(acTimeout);
  acTimeout = setTimeout(() => fetchSuggestions(q), 350);
});

guessInput.addEventListener("keydown", (e) => {
  const items  = document.querySelectorAll(".ac-item");
  const active = document.querySelector(".ac-item.active");
  if (e.key === "ArrowDown") {
    e.preventDefault();
    if (!active) items[0]?.classList.add("active");
    else { active.classList.remove("active"); (active.nextElementSibling || items[0]).classList.add("active"); }
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    if (!active) items[items.length - 1]?.classList.add("active");
    else { active.classList.remove("active"); (active.previousElementSibling || items[items.length - 1]).classList.add("active"); }
  } else if (e.key === "Escape") {
    closeSuggestions();
  }
  if (e.key === "Enter" && active) {
    e.stopImmediatePropagation();
    guessInput.value = active.dataset.title;
    closeSuggestions();
    submitGuess();
  }
});

async function fetchSuggestions(q) {
  if (acCache[q]) { showSuggestions(acCache[q]); return; }
  try {
    const res    = await fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(q)}&limit=6&sfw`);
    const json   = await res.json();
    const titles = (json.data || []).map(a => a.title_english || a.title).filter(Boolean);
    acCache[q]   = titles;
    showSuggestions(titles);
  } catch {}
}

function showSuggestions(titles) {
  closeSuggestions();
  if (!titles.length) return;
  const box = document.createElement("div");
  box.id = "ac-box";
  box.className = "ac-box";
  titles.forEach(title => {
    const item = document.createElement("div");
    item.className = "ac-item";
    item.textContent = title;
    item.dataset.title = title;
    item.addEventListener("mousedown", (e) => {
      e.preventDefault();
      guessInput.value = title;
      closeSuggestions();
      guessInput.focus();
    });
    box.appendChild(item);
  });
  guessInput.parentElement.style.position = "relative";
  guessInput.parentElement.appendChild(box);
}

function closeSuggestions() { document.getElementById("ac-box")?.remove(); }

document.addEventListener("click", (e) => {
  if (!e.target.closest(".guess-input-wrap")) closeSuggestions();
});

// ── UI ──
function renderRevealedClues(count) {
  cluesList.innerHTML = "";
  lastRevealedCount = 0;
  for (let i = 0; i < count; i++) {
    if (roomData.clueValues?.[i]) renderClueItem(roomData.clueValues[i], false);
  }
  lastRevealedCount = count;
  clueCountEl.textContent = `${count} / ${TOTAL_CLUES}`;
}

function renderClueItem(clue, isNew) {
  document.querySelectorAll(".clue-new").forEach(el => el.classList.remove("clue-new"));
  const el = document.createElement("div");
  el.className = `clue-item${isNew ? " clue-new" : ""}`;
  el.innerHTML = `
    <div class="clue-label">${escHtml(clue.label)}</div>
    <div class="clue-value">${escHtml(clue.value)}</div>
  `;
  cluesList.appendChild(el);
  el.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function addGuessToHistory(guessText, isMe) {
  const el = document.createElement("div");
  el.className = `guess-entry ${isMe ? "mine" : "theirs"}`;
  el.innerHTML = `
    <span class="guess-entry-who">${isMe ? "YOU" : "OPP"}</span>
    <span class="guess-entry-text">${escHtml(guessText)}</span>
    <span class="guess-entry-x">✗</span>
  `;
  guessHistory.prepend(el);
}

function showWrongFeedback(guess) {
  guessFeedback.textContent = `✗ "${guess}"`;
  guessFeedback.className = "guess-feedback feedback-wrong";
  guessInput.classList.add("shake");
  setTimeout(() => {
    guessInput.classList.remove("shake");
    guessFeedback.textContent = "";
    guessFeedback.className = "guess-feedback";
  }, 800);
}

function showResult(data) {
  clearTimerInterval();

  if (data.draw) {
    resultIcon.textContent  = "🤝";
    resultTitle.textContent = "DRAW";
    resultTitle.className   = "result-title";
  } else {
    const iWon = data.winner === player.uid;
    resultIcon.textContent  = iWon ? "🏆" : "💀";
    resultTitle.textContent = iWon ? "YOU WIN" : "YOU LOSE";
    resultTitle.className   = `result-title ${iWon ? "win-title" : "lose-title"}`;
  }

  resultAnime.textContent = data.animeTitle || "Unknown";
  if (data.animeImage) {
    resultImg.src = data.animeImage;
    resultImg.classList.remove("hidden");
  }

  resultOverlay.classList.remove("hidden");
}

function showDisconnect() {
  clearTimerInterval();
  gameOver = true;
  dcOverlay.classList.remove("hidden");
}

// ── Play Again — in-place rematch, no page navigation ──
//
// Both players press "Play Again". Each write their ready flag to
// rematchReady.{hostReady|guestReady}. When both are set, the host
// fetches a new anime, resets the room doc, and bumps rematchVersion.
// handleRoomUpdate detects the version bump and reloads the page for
// both players — giving them a clean slate in the same room.

playAgainBtn.addEventListener("click", async () => {
  if (iWantRematch) return;      // don't double-fire
  iWantRematch = true;

  playAgainBtn.textContent = "WAITING FOR OPPONENT…";
  playAgainBtn.disabled    = true;

  const field = amHost ? "rematchReady.hostReady" : "rematchReady.guestReady";
  try {
    await updateDoc(roomRef, { [field]: true });
  } catch {
    iWantRematch             = false;
    playAgainBtn.textContent = "PLAY AGAIN";
    playAgainBtn.disabled    = false;
  }
});

function updateRematchButtonState(rematchReady) {
  if (!iWantRematch) return;   // only update if we already pressed
  const oppReady = amHost ? rematchReady.guestReady : rematchReady.hostReady;
  if (oppReady) {
    playAgainBtn.textContent = "LOADING…";
  }
}

async function resetRoomForRematch() {
  try {
    playAgainBtn.textContent = "LOADING…";

    const animeId    = pickRandomAnimeId();
    const animeData  = await fetchEnrichedAnime(animeId);
    const clueValues = buildClueValues(animeData);

    const currentVersion = roomData.rematchVersion ?? 0;

    await updateDoc(roomRef, {
      animeId:            animeId,
      animeTitle:         animeData.title,
      animeTitleEnglish:  animeData.title_english  || "",
      animeTitleJapanese: animeData.title_japanese || "",
      animeTitles:        animeData.titles         || [],
      animeImage:         animeData.images?.jpg?.image_url || null,
      clueValues:         clueValues,
      round:              0,
      timerEndsAt:        null,
      revealedClueCount:  0,
      suddenDeath:        false,
      winner:             null,
      winnerName:         null,
      draw:               false,
      status:             "in_progress",
      rematchReady:       { hostReady: false, guestReady: false },
      rematchVersion:     currentVersion + 1,
      deleteAt:           Date.now() + 30 * 60 * 1000
    });
    // The version bump triggers window.location.reload() in handleRoomUpdate for both players
  } catch (err) {
    console.error("Rematch reset failed:", err);
    playAgainBtn.textContent = "PLAY AGAIN";
    iWantRematch = false;
  }
}

backLobbyBtn.addEventListener("click", () => { window.location.href = "index.html"; });
dcLobbyBtn.addEventListener("click",   () => { window.location.href = "index.html"; });

async function scheduleRoomCleanup() {
  try { await updateDoc(roomRef, { deleteAt: Date.now() + 10 * 60 * 1000 }); } catch {}
}

window.addEventListener("beforeunload", () => {
  // Don't signal disconnect during a rematch reload or after game is over
  if (!gameOver && !rematchResetInFlight && roomData) {
    updateDoc(roomRef, { status: "disconnected" }).catch(() => {});
  }
});

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

init();