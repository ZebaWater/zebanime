// game.js

import { db } from "./firebase-init.js";
import { getPlayer } from "./player.js";
import { checkGuess } from "./jikan.js";
import { TOTAL_CLUES } from "./clues.js";
import {
  doc, getDoc, updateDoc, addDoc, collection,
  onSnapshot, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const ROUND_TIMERS = [30, 28, 25, 22, 20, 18, 16, 15, 15, 15];
const SD_TIMER = 30;
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
let roomData          = null;
let timerInterval     = null;
let lastRevealedCount = 0;
let amHost            = false;
let guessLocked       = false;
let gameOver          = false;

hudMyName.textContent = player.name.toUpperCase();

// ── Init ──
async function init() {
  const snap = await getDoc(roomRef);
  if (!snap.exists()) { window.location.href = "index.html"; return; }

  roomData = snap.data();
  amHost   = roomData.hostId === player.uid;

  const oppName = amHost ? roomData.guestName : roomData.hostName;
  hudOppName.textContent = (oppName || "OPPONENT").toUpperCase();

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

  if (data.timerEndsAt) {
    const endsAt = data.timerEndsAt.toMillis?.() ?? data.timerEndsAt;
    startCountdown(endsAt, data.round, data.suddenDeath);
  }

  guessLocked = false;
  guessInput.disabled = false;
  guessBtn.disabled = false;
}

// ── Guess update handler ──
function handleGuessUpdate(snap) {
  snap.docChanges().forEach(change => {
    if (change.type === "added") {
      const g    = change.doc.data();
      const isMe = g.uid === player.uid;
      addGuessToHistory(g.guess, isMe);
    }
  });
}

// ── Round advancement ──
async function startNextRound(roundNum) {
  const isSuddenDeath = roundNum > TOTAL_CLUES;
  const timerSecs     = isSuddenDeath ? SD_TIMER : (ROUND_TIMERS[roundNum - 1] ?? 20);
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
function startCountdown(endsAtMs, round, suddenDeath) {
  clearTimerInterval();
  const totalSecs = suddenDeath ? SD_TIMER : (ROUND_TIMERS[round - 1] ?? 20);

  timerInterval = setInterval(async () => {
    const remaining = Math.max(0, Math.ceil((endsAtMs - Date.now()) / 1000));
    const progress  = remaining / totalSecs;

    ringFillEl.style.strokeDashoffset = RING_CIRCUMFERENCE * (1 - progress);
    timerTextEl.textContent = remaining;

    timerWrap.classList.remove("timer-low", "timer-critical");
    if (remaining <= 5)       timerWrap.classList.add("timer-critical");
    else if (remaining <= 12) timerWrap.classList.add("timer-low");

    if (remaining <= 0) {
      clearTimerInterval();
      if (!amHost || gameOver) return;

      guessLocked = true;

      if (suddenDeath) {
        // Sudden death expired — draw
        await updateDoc(roomRef, { draw: true, status: "finished" });
        scheduleRoomCleanup();
      } else {
        const nextRound = (roomData?.round ?? round) + 1;
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
  guessLocked = true;
  guessInput.disabled = true;
  guessBtn.disabled = true;

  const correct = checkGuess(guess, buildAnimeProxy());

  await addDoc(collection(db, "rooms", roomCode, "guesses"), {
    uid:       player.uid,
    name:      player.name,
    guess,
    round:     roomData.round,
    correct,
    timestamp: serverTimestamp()
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

// ── Nav ──
playAgainBtn.addEventListener("click", () => { window.location.href = "index.html"; });
backLobbyBtn.addEventListener("click", () => { window.location.href = "index.html"; });
dcLobbyBtn.addEventListener("click",   () => { window.location.href = "index.html"; });

async function scheduleRoomCleanup() {
  try { await updateDoc(roomRef, { deleteAt: Date.now() + 10 * 60 * 1000 }); } catch {}
}

window.addEventListener("beforeunload", () => {
  if (!gameOver && roomData) {
    updateDoc(roomRef, { status: "disconnected" }).catch(() => {});
  }
});

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

init();