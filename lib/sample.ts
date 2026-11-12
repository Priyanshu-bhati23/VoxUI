/**
 * A hand-written example document, bundled with the app.
 * It lets visitors see the preview, code view and download working without an
 * API key. The interface labels it as a sample, not as AI output.
 */
export const SAMPLE_REQUEST = "A focus timer with start, pause and reset";

export const SAMPLE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Focus timer</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f3efe6; color: #1d2a26; font-family: system-ui, sans-serif; }
  main { width: min(360px, 92vw); text-align: center; }
  h1 { margin: 0 0 4px; font-size: 20px; }
  p { margin: 0 0 22px; color: #5d6b66; }
  .dial { position: relative; width: 240px; height: 240px; margin: 0 auto 24px; }
  svg { transform: rotate(-90deg); }
  circle { fill: none; stroke-width: 14; }
  .track { stroke: #dcd5c5; }
  .bar { stroke: #1f7a5c; stroke-linecap: round; transition: stroke-dashoffset 0.4s linear; }
  .time { position: absolute; inset: 0; display: grid; place-items: center; font-size: 54px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .modes, .actions { display: flex; gap: 8px; justify-content: center; }
  .modes { margin-bottom: 22px; }
  button { font: inherit; padding: 10px 16px; border-radius: 999px; border: 2px solid #1d2a26; background: transparent; color: inherit; cursor: pointer; }
  button:focus-visible { outline: 3px solid #f2a33a; outline-offset: 2px; }
  button[aria-pressed="true"], .primary { background: #1d2a26; color: #f3efe6; }
  .done { margin-top: 18px; font-weight: 600; min-height: 1.4em; }
</style>
</head>
<body>
<main>
  <h1>Focus timer</h1>
  <p>Work in short sprints, then rest.</p>
  <div class="modes" role="group" aria-label="Session length">
    <button data-min="25" aria-pressed="true">Focus 25</button>
    <button data-min="5" aria-pressed="false">Break 5</button>
    <button data-min="15" aria-pressed="false">Break 15</button>
  </div>
  <div class="dial">
    <svg width="240" height="240" viewBox="0 0 240 240" aria-hidden="true">
      <circle class="track" cx="120" cy="120" r="105"></circle>
      <circle class="bar" cx="120" cy="120" r="105"></circle>
    </svg>
    <div class="time" role="timer" aria-live="off">25:00</div>
  </div>
  <div class="actions">
    <button class="primary" id="toggle">Start</button>
    <button id="reset">Reset</button>
  </div>
  <div class="done" aria-live="polite"></div>
</main>
<script>
  var total = 25 * 60, left = total, timer = null;
  var bar = document.querySelector(".bar"), time = document.querySelector(".time");
  var toggle = document.getElementById("toggle"), done = document.querySelector(".done");
  var ring = 2 * Math.PI * 105;
  bar.style.strokeDasharray = ring;

  function draw() {
    var m = Math.floor(left / 60), s = left % 60;
    time.textContent = (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
    bar.style.strokeDashoffset = ring * (1 - left / total);
  }
  function stop() { clearInterval(timer); timer = null; toggle.textContent = left < total ? "Resume" : "Start"; }
  function tick() {
    left -= 1; draw();
    if (left <= 0) { stop(); toggle.textContent = "Start"; done.textContent = "Time is up. Nice work."; left = total; }
  }
  toggle.addEventListener("click", function () {
    if (timer) return stop();
    done.textContent = ""; draw();
    timer = setInterval(tick, 1000); toggle.textContent = "Pause";
  });
  document.getElementById("reset").addEventListener("click", function () { left = total; stop(); toggle.textContent = "Start"; done.textContent = ""; draw(); });
  document.querySelectorAll(".modes button").forEach(function (b) {
    b.addEventListener("click", function () {
      document.querySelectorAll(".modes button").forEach(function (x) { x.setAttribute("aria-pressed", x === b); });
      total = left = Number(b.dataset.min) * 60; stop(); toggle.textContent = "Start"; done.textContent = ""; draw();
    });
  });
  draw();
</script>
</body>
</html>`;
