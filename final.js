// Reads the score data passed from index.html via URL query params
// and fills in the result card. No storage/backend involved.

const params = new URLSearchParams(window.location.search);

const score = params.get("score") || "0";
const max = params.get("max") || "0";
const accuracy = params.get("accuracy") || "0";
const rounds = params.get("rounds") || "0";
const total = params.get("total") || "0";

document.getElementById("scoreValue").textContent = `${score} / ${max}`;
document.getElementById("accuracyValue").textContent = `${accuracy}%`;
document.getElementById("roundsValue").textContent = `${rounds} / ${total}`;
