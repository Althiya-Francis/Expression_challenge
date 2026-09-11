/* ============================================================
   Expression Challenge — script.js
   Plain browser JavaScript. No build step, no backend.
   ============================================================ */

/* ============================================================
   SECTION A — EASY-TO-EDIT SETTINGS
   Change these values to tune the game.
   ============================================================ */

const TOTAL_ROUNDS = 16;        // how many images are in the challenge
const ROUND_DURATION = 5;       // seconds per round
const MATCH_THRESHOLD = 0.70;   // 70% average confidence counts as a "match"
const RESULT_POPUP_DELAY = 1300; // ms the result pop-up stays on screen
const DETECTION_INTERVAL = 200;  // ms between each face-api detection tick

/* ============================================================
   SECTION B — TARGET IMAGE → EXPRESSION MAPPING
   Edit this list to change which expression each image expects.
   "expression" must be one of: happy, sad, angry, surprised,
   fearful, disgusted, neutral  (these match face-api.js's labels)
   ============================================================ */

const challenges = [
  { image: "images/image1.jpg",  expression: "happy",     name: "HAPPY" },
  { image: "images/image2.jpg",  expression: "surprised",  name: "SURPRISED" },
  { image: "images/image3.jpg",  expression: "fearful",    name: "FEARFUL" },
  { image: "images/image4.jpg",  expression: "angry",      name: "ANGRY" },
  { image: "images/image5.jpg",  expression: "happy",      name: "HAPPY" },
  { image: "images/image6.jpg",  expression: "sad",        name: "SAD" },
  { image: "images/image7.jpg",  expression: "happy",      name: "HAPPY" },
  { image: "images/image8.jpg",  expression: "neutral",    name: "NEUTRAL" },
  { image: "images/image9.jpg",  expression: "neutral",    name: "NEUTRAL" },
  { image: "images/image10.jpg", expression: "happy",      name: "HAPPY" },
  { image: "images/image11.jpg", expression: "surprised",  name: "SURPRISED" },
  { image: "images/image12.jpg", expression: "angry",      name: "ANGRY" },
  { image: "images/image13.jpg", expression: "happy",      name: "HAPPY" },
  { image: "images/image14.jpg", expression: "sad",        name: "SAD" },
  { image: "images/image15.jpg", expression: "fearful",    name: "FEARFUL" },
  { image: "images/image16.jpg", expression: "happy",      name: "HAPPY" },
];

/* ============================================================
   SECTION C — DOM REFERENCES
   ============================================================ */

const video            = document.getElementById("webcam");
const scrim             = document.getElementById("scrim");

const loadingScreen     = document.getElementById("loadingScreen");
const loadingText       = document.getElementById("loadingText");
const permissionScreen  = document.getElementById("permissionScreen");
const permissionText    = document.getElementById("permissionText");
const retryButton       = document.getElementById("retryButton");

const targetPanel       = document.getElementById("targetPanel");
const targetImage       = document.getElementById("targetImage");

const timerPanel        = document.getElementById("timerPanel");
const timerRing         = document.getElementById("timerRing");
const timerText         = document.getElementById("timerText");

const accuracyPanel     = document.getElementById("accuracyPanel");
const accuracyRing      = document.getElementById("accuracyRing");
const accuracyText      = document.getElementById("accuracyText");

const scorePanel         = document.getElementById("scorePanel");
const scoreText         = document.getElementById("scoreText");

const faceWarning       = document.getElementById("faceWarning");

const resultModal       = document.getElementById("resultModal");
const resultIcon        = document.getElementById("resultIcon");
const resultTitle       = document.getElementById("resultTitle");
const resultAccuracy    = document.getElementById("resultAccuracy");

const finalModal        = document.getElementById("finalModal");
const finalScore        = document.getElementById("finalScore");
const finalAccuracy     = document.getElementById("finalAccuracy");
const finalRounds       = document.getElementById("finalRounds");
const playAgainButton   = document.getElementById("playAgainButton");

/* ============================================================
   SECTION D — RING GEOMETRY HELPERS
   Both rings use r=42, so circumference is constant.
   ============================================================ */

const RING_CIRCUMFERENCE = 2 * Math.PI * 42; // ≈ 263.9

function setRingProgress(ringEl, fraction) {
  const clamped = Math.max(0, Math.min(1, fraction));
  const offset = RING_CIRCUMFERENCE * (1 - clamped);
  ringEl.style.strokeDasharray = `${RING_CIRCUMFERENCE}`;
  ringEl.style.strokeDashoffset = `${offset}`;
}

/* ============================================================
   SECTION E — GAME STATE
   ============================================================ */

let currentRoundIndex = 0;
let roundActive = false;
let detectionTimerId = null;
let countdownTimerId = null;
let secondsRemaining = ROUND_DURATION;

let samples = [];          // confidence samples collected for the target expression this round
let totalScore = 0;        // sum of round accuracies (0-100) across completed rounds
let roundAccuracies = [];  // history of each round's final accuracy (0-100)

let modelsReady = false;
let faceWarningTimeoutId = null;

/* ============================================================
   SECTION F — STARTUP FLOW
   ============================================================ */

window.addEventListener("DOMContentLoaded", startApp);

async function startApp() {
  showLoading("Requesting camera access…");

  try {
    await startCamera();
  } catch (err) {
    console.error("Camera error:", err);
    showPermissionScreen(err);
    return;
  }

  try {
    showLoading("Loading AI models…");
    await loadModels();
    modelsReady = true;
  } catch (err) {
    console.error("Model loading error:", err);
    showPermissionScreen(err, true);
    return;
  }

  hideLoading();
  revealHud();
  beginRound(0);
}

async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("getUserMedia-unsupported");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user" },
    audio: false,
  });

  video.srcObject = stream;

  await new Promise((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("video-error"));
  });

  await video.play();
}

// Primary source: your local models/ folder (fastest, works offline).
// Fallback source: a verified public mirror of the same official
// face-api.js weight files. This only kicks in if the local files are
// missing/corrupted, so the game still works even before you fix
// the models/ folder — see the setup notes for how to fix it permanently.
const LOCAL_MODEL_URL = "./models";
const FALLBACK_MODEL_URL = "https://huggingface.co/Taha32/FaceApi/resolve/main";

async function loadModels() {
  try {
    await faceapi.nets.tinyFaceDetector.loadFromUri(LOCAL_MODEL_URL);
    await faceapi.nets.faceExpressionNet.loadFromUri(LOCAL_MODEL_URL);
    console.log("Models loaded from local models/ folder.");
  } catch (localErr) {
    console.warn("Local models failed to load, falling back to CDN copy:", localErr);
    showLoading("Local models missing — loading from backup source…");
    faceapi.nets.tinyFaceDetector.reset?.();
    faceapi.nets.faceExpressionNet.reset?.();
    await faceapi.nets.tinyFaceDetector.loadFromUri(FALLBACK_MODEL_URL);
    await faceapi.nets.faceExpressionNet.loadFromUri(FALLBACK_MODEL_URL);
    console.log("Models loaded from fallback CDN.");
  }
}

function showLoading(message) {
  loadingText.textContent = message;
  loadingScreen.classList.remove("hidden");
  permissionScreen.classList.add("hidden");
}

function hideLoading() {
  loadingScreen.classList.add("hidden");
}

function showPermissionScreen(err, isModelError) {
  loadingScreen.classList.add("hidden");

  let message = "This game needs your webcam to see your expressions. Please allow camera access and reload the page.";

  if (isModelError) {
    message = "The AI models failed to load from both your local models/ folder and the backup source. Check your internet connection (needed for the backup source) and that you're running this through a local server (not a file:// double-click), then try again.";
  } else if (err && err.name === "NotAllowedError") {
    message = "Camera permission was denied. Please allow camera access in your browser settings, then try again.";
  } else if (err && err.name === "NotFoundError") {
    message = "No camera was found on this device. Please connect a webcam and try again.";
  } else if (err && err.message === "getUserMedia-unsupported") {
    message = "This browser doesn't support webcam access. Please try a modern browser like Chrome, Edge, or Firefox.";
  }

  permissionText.textContent = message;
  permissionScreen.classList.remove("hidden");
}

targetImage.addEventListener("error", () => {
  console.error("Target image failed to load:", targetImage.src);
});

retryButton.addEventListener("click", () => {
  permissionScreen.classList.add("hidden");
  startApp();
});

function revealHud() {
  targetPanel.classList.remove("hidden");
  timerPanel.classList.remove("hidden");
  accuracyPanel.classList.remove("hidden");
  scorePanel.classList.remove("hidden");
}

/* ============================================================
   SECTION G — ROUND FLOW
   ============================================================ */

function beginRound(index) {
  currentRoundIndex = index;
  const challenge = challenges[index];

  // Reset per-round state
  samples = [];
  secondsRemaining = ROUND_DURATION;
  roundActive = true;

  // Update target panel (image only — no text label or round counter shown,
  // so nothing about the expression's name is visible to the player)
  targetImage.src = challenge.image;

  // Reset rings
  timerText.textContent = String(ROUND_DURATION);
  setRingProgress(timerRing, 1);
  accuracyText.textContent = "0%";
  setRingProgress(accuracyRing, 0);

  // Start countdown + detection loop
  startCountdown();
  startDetectionLoop();
}

function startCountdown() {
  clearInterval(countdownTimerId);
  countdownTimerId = setInterval(() => {
    secondsRemaining -= 1;

    if (secondsRemaining <= 0) {
      timerText.textContent = "0";
      setRingProgress(timerRing, 0);
      clearInterval(countdownTimerId);
      endRound();
      return;
    }

    timerText.textContent = String(secondsRemaining);
    setRingProgress(timerRing, secondsRemaining / ROUND_DURATION);
  }, 1000);
}

function startDetectionLoop() {
  clearInterval(detectionTimerId);
  detectionTimerId = setInterval(detectExpressionTick, DETECTION_INTERVAL);
}

function stopDetectionLoop() {
  clearInterval(detectionTimerId);
}

async function detectExpressionTick() {
  if (!roundActive || !modelsReady) return;
  if (video.readyState < 2) return; // not enough data yet

  try {
    const detection = await faceapi
      .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions())
      .withFaceExpressions();

    if (!detection || detection.length === 0) {
      showFaceWarning("Face not detected");
      return;
    }

    if (detection.length > 1) {
      showFaceWarning("Please keep only one face in view");
      // still use the first face so the round can continue
    } else {
      hideFaceWarning();
    }

    const expressions = detection[0].expressions;
    const target = challenges[currentRoundIndex].expression;
    const confidence = expressions[target] || 0; // 0..1

    samples.push(confidence);

    // Live accuracy: weighted average favouring the most recent samples,
    // so the ring responds to what the user is doing *right now* while
    // still staying stable rather than jumping around.
    const liveAccuracy = computeWeightedAverage(samples) * 100;
    updateAccuracyDisplay(liveAccuracy);
  } catch (err) {
    console.error("Detection error:", err);
  }
}

function computeWeightedAverage(values) {
  if (values.length === 0) return 0;
  let weightedSum = 0;
  let weightTotal = 0;
  values.forEach((value, i) => {
    // Linear weight: later (more recent) samples count more.
    const weight = i + 1;
    weightedSum += value * weight;
    weightTotal += weight;
  });
  return weightedSum / weightTotal;
}

function updateAccuracyDisplay(accuracyPercent) {
  const clamped = Math.max(0, Math.min(100, accuracyPercent));
  accuracyText.textContent = `${Math.round(clamped)}%`;
  setRingProgress(accuracyRing, clamped / 100);
}

function showFaceWarning(message) {
  faceWarning.textContent = message;
  faceWarning.classList.remove("hidden");
  clearTimeout(faceWarningTimeoutId);
  faceWarningTimeoutId = setTimeout(hideFaceWarning, 1500);
}

function hideFaceWarning() {
  faceWarning.classList.add("hidden");
}

function endRound() {
  roundActive = false;
  stopDetectionLoop();

  const finalAccuracyValue = Math.max(0, Math.min(100, computeWeightedAverage(samples) * 100));
  const matched = finalAccuracyValue / 100 >= MATCH_THRESHOLD;

  totalScore += finalAccuracyValue;
  roundAccuracies.push(finalAccuracyValue);

  showResultModal(matched, finalAccuracyValue);

  setTimeout(() => {
    hideResultModal();

    const nextIndex = currentRoundIndex + 1;
    if (nextIndex >= TOTAL_ROUNDS) {
      showFinalModal();
    } else {
      beginRound(nextIndex);
    }
  }, RESULT_POPUP_DELAY);
}

/* ============================================================
   SECTION H — MODALS
   ============================================================ */

function showResultModal(matched, accuracyValue) {
  scrim.classList.remove("hidden");

  resultModal.classList.remove("success", "fail");
  resultModal.classList.add(matched ? "success" : "fail");

  resultIcon.textContent = matched ? "✓" : "✕";
  resultTitle.textContent = matched ? "Correct!" : "Try Again";
  resultAccuracy.textContent = `${Math.round(accuracyValue)}%`;

  resultModal.classList.remove("hidden");
}

function hideResultModal() {
  resultModal.classList.add("hidden");
  scrim.classList.add("hidden");
}

// If the player's total score reaches this fraction of the maximum
// possible score, they get redirected to the celebratory final.html
// page instead of the in-page modal. Easy to change.
const PASS_SCORE_FRACTION = 0.5;

function showFinalModal() {
  const avgAccuracy = roundAccuracies.length
    ? roundAccuracies.reduce((a, b) => a + b, 0) / roundAccuracies.length
    : 0;

  const scoreValue = Math.round(totalScore);
  const maxScore = TOTAL_ROUNDS * 100;

  if (scoreValue >= maxScore * PASS_SCORE_FRACTION) {
    const params = new URLSearchParams({
      score: scoreValue,
      max: maxScore,
      accuracy: Math.round(avgAccuracy),
      rounds: roundAccuracies.length,
      total: TOTAL_ROUNDS,
    });
    window.location.href = `final.html?${params.toString()}`;
    return;
  }

  finalScore.textContent = `${scoreValue} / ${maxScore}`;
  finalAccuracy.textContent = `${Math.round(avgAccuracy)}%`;
  finalRounds.textContent = `${roundAccuracies.length} / ${TOTAL_ROUNDS}`;

  scrim.classList.remove("hidden");
  finalModal.classList.remove("hidden");

  targetPanel.classList.add("hidden");
  timerPanel.classList.add("hidden");
  accuracyPanel.classList.add("hidden");
}

playAgainButton.addEventListener("click", () => {
  totalScore = 0;
  roundAccuracies = [];
  scoreText.textContent = "0";

  finalModal.classList.add("hidden");
  scrim.classList.add("hidden");

  revealHud();
  beginRound(0);
});

/* Keep the subtle score readout in sync after every round */
const scoreObserverInterval = setInterval(() => {
  scoreText.textContent = String(Math.round(totalScore));
}, 300);
