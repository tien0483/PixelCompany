// Service worker for the PIXTiel PWA.
// Catches navigation failures (server not running / crashed) and serves a
// branded fallback page that auto-refreshes once the server is reachable.

const CACHE_NAME = "pixtiel-fallback-pixtiel-1";

const FALLBACK_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>PIXTiel</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{
    background:#1F2428;
    color:#6E7681;
    font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;
    display:flex;
    height:100svh;
    align-items:center;
    justify-content:center;
    padding:24px;
  }
  .container{
    display:flex;
    flex-direction:column;
    align-items:center;
    justify-content:center;
    gap:12px;
    padding:48px 0;
  }
  h3{font-size:16px;font-weight:600;color:#E6EDF3}
  p{font-size:14px;color:#8B949E;text-align:center;line-height:1.5}
  .spinner{
    width:20px;height:20px;
    border:2px solid #30363D;
    border-top-color:#8B949E;
    border-radius:50%;
    animation:spin .8s linear infinite;
    margin-top:8px;
  }
  @keyframes spin{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<div class="container">
  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="12" x2="12" y1="8" y2="12"/>
    <line x1="12" x2="12.01" y1="16" y2="16"/>
  </svg>
  <h3>Waiting for PIXTiel</h3>
  <p>Starting backend in WSL, then connecting…</p>
  <p id="backend-status" style="font-size:13px;color:#8B949E;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">Probing backend…</p>
  <div class="spinner"></div>
  <p id="cert-hint" style="display:none;margin-top:12px;color:#D29922;font-size:13px;line-height:1.5;max-width:420px">
    Unable to connect. If you are using HTTPS with a self-signed certificate,<br/>
    open this URL directly and accept the browser certificate warning (Advanced &rarr; Proceed), then reload.
  </p>
</div>
<script>
  (function poll(failures) {
    var statusEl = document.getElementById("backend-status");
    var attempt = failures + 1;
    var msg = "[PIXTiel] backend probe #" + attempt + " → " + location.origin + "/";
    console.log(msg);
    if (statusEl) statusEl.textContent = "Backend probe #" + attempt + " — " + location.origin;
    fetch("/", { method: "HEAD", cache: "no-store" })
      .then(function(r) {
        if (r.ok) {
          console.log("[PIXTiel] backend ready (HTTP " + r.status + ") — reloading");
          if (statusEl) statusEl.textContent = "Backend ready — loading app…";
          location.reload();
          return;
        }
        console.warn("[PIXTiel] backend not ready (HTTP " + r.status + "), retry in 2s");
        if (statusEl) statusEl.textContent = "Backend HTTP " + r.status + " — retrying…";
        setTimeout(function() { poll(0); }, 2000);
      })
      .catch(function(err) {
        console.warn("[PIXTiel] backend unreachable:", err && err.message ? err.message : err);
        if (statusEl) statusEl.textContent = "Backend unreachable — attempt #" + attempt;
        if (failures >= 3 && location.protocol === "https:") {
          var hint = document.getElementById("cert-hint");
          if (hint) hint.style.display = "block";
        }
        setTimeout(function() { poll(failures + 1); }, 2000);
      });
  })(0);
</script>
</body>
</html>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  // Only intercept navigation requests (page loads), not API calls or assets.
  if (event.request.mode !== "navigate") return;

  event.respondWith(
    fetch(event.request).catch(() =>
      new Response(FALLBACK_HTML, {
        status: 503,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      })
    )
  );
});
