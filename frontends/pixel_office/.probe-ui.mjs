import { chromium } from "@playwright/test";

const URL = process.argv[2] ?? "http://127.0.0.1:3484/pixelcompany";
const WAIT_MS = Number(process.argv[3] ?? 40000);
const OUT = "/tmp/claude-1000/-home-ubuntu-work-PixelCompany/a6c423c6-b29b-40d5-aa47-0dd0835235f3/scratchpad";

const t0 = Date.now();
const t = () => `${((Date.now() - t0) / 1000).toFixed(2)}s`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ serviceWorkers: "allow" });
const page = await ctx.newPage();

page.on("console", (m) => {
  const type = m.type();
  if (type === "error" || type === "warning" || /Pixel|error|fail/i.test(m.text())) {
    console.log(`[${t()}] console.${type}: ${m.text().slice(0, 400)}`);
  }
});
page.on("pageerror", (e) => console.log(`[${t()}] PAGEERROR: ${e.message?.slice(0, 600)}`));
page.on("requestfailed", (r) =>
  console.log(`[${t()}] REQFAILED ${r.method()} ${r.url().slice(0, 120)} — ${r.failure()?.errorText}`),
);
page.on("response", (r) => {
  if (r.status() >= 400) console.log(`[${t()}] HTTP ${r.status()} ${r.url().slice(0, 120)}`);
});
page.on("websocket", (ws) => {
  console.log(`[${t()}] WS open ${ws.url().slice(0, 120)}`);
  ws.on("framereceived", (f) => {
    const payload = typeof f.payload === "string" ? f.payload : f.payload.toString("utf8");
    console.log(`[${t()}] WS recv ${payload.length}B type=${payload.slice(9, 40)}`);
  });
  ws.on("close", () => console.log(`[${t()}] WS closed`));
  ws.on("socketerror", (e) => console.log(`[${t()}] WS error ${e}`));
});

console.log(`[${t()}] goto ${URL}`);
try {
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  console.log(`[${t()}] domcontentloaded`);
} catch (e) {
  console.log(`[${t()}] GOTO FAILED: ${e.message.slice(0, 300)}`);
}

const deadline = Date.now() + WAIT_MS;
let last = "";
while (Date.now() < deadline) {
  const snap = await page
    .evaluate(() => {
      const root = document.getElementById("root");
      const txt = (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 220);
      return `nodes=${root?.childElementCount ?? -1} text="${txt}"`;
    })
    .catch((e) => `eval-failed ${e.message.slice(0, 80)}`);
  if (snap !== last) {
    console.log(`[${t()}] DOM ${snap}`);
    last = snap;
  }
  await page.waitForTimeout(2000);
}

await page.screenshot({ path: `${OUT}/ui.png`, fullPage: false });
console.log(`[${t()}] screenshot -> ${OUT}/ui.png`);
await browser.close();
