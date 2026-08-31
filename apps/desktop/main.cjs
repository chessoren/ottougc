"use strict";

/**
 * OttoUGC, as a desktop application.
 *
 * The reason this exists rather than a deployment: the loop cannot run on
 * serverless. One Omni shot takes forty seconds and a video needs three to
 * seven of them; a Remotion render pins a Chromium process for minutes; the
 * media files are hundreds of megabytes. Vercel caps a function at sixty
 * seconds and throws the filesystem away between invocations. The work fits a
 * laptop perfectly and fits a lambda not at all.
 *
 * ── The one rule this process exists to enforce ──────────────────────────────
 *
 * **Exactly one process owns the database.**
 *
 * PGlite is Postgres compiled to WebAssembly with a single-writer directory. On
 * 31 August the CLI and a reader touched `.pglite` at the same moment and the
 * database did not merely lock — it corrupted, unrecoverably, and every run in
 * it was lost. So this shell never opens the database itself and never spawns
 * the CLI. It starts the Next server, and everything else — the daily
 * production, publishing, metric ingestion, the weekly review — goes through
 * that server's own HTTP endpoints. One owner, one writer, no second opinion.
 */

const { app, BrowserWindow, Menu, shell, dialog, nativeImage } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");

const WEB_DIR = path.join(__dirname, "..", "web");
const ICON = nativeImage.createFromPath(path.join(__dirname, "assets", "icon.png"));
const PORT = Number(process.env.OTTOUGC_PORT || 3776);
const ORIGIN = `http://127.0.0.1:${PORT}`;

/** @type {import('node:child_process').ChildProcess | null} */
let server = null;
/** @type {BrowserWindow | null} */
let window_ = null;
/** @type {NodeJS.Timeout | null} */
let clock = null;
const log = [];

function note(line) {
  const stamped = `${new Date().toISOString().slice(11, 19)}  ${line}`;
  log.push(stamped);
  if (log.length > 500) log.shift();
  console.log(stamped);
}

/* ==========================================================================
   The server
   ========================================================================== */

function readEnvFile() {
  const file = path.join(WEB_DIR, ".env.local");
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[line.slice(0, eq).trim()] = value;
  }
  return out;
}

function startServer() {
  const built = fs.existsSync(path.join(WEB_DIR, ".next", "BUILD_ID"));
  const nextBin = path.join(__dirname, "..", "..", "node_modules", "next", "dist", "bin", "next");

  if (!fs.existsSync(nextBin)) {
    dialog.showErrorBox(
      "Dependencies are missing",
      "Run `pnpm install` in the project root, then open OttoUGC again.",
    );
    app.quit();
    return;
  }

  // A production build starts in about a second and does not recompile a route
  // on first visit. Without one, fall back to dev so the app still opens — but
  // say which mode it is in, because dev is noticeably slower.
  const mode = built ? "start" : "dev";
  note(`Starting the Next server in ${mode} mode on ${ORIGIN}.`);

  server = spawn(process.execPath, [nextBin, mode, "-p", String(PORT)], {
    cwd: WEB_DIR,
    env: {
      ...process.env,
      ...readEnvFile(),
      NODE_ENV: built ? "production" : "development",
      // Electron sets this for its own bundled node; Next must not see it.
      ELECTRON_RUN_AS_NODE: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  server.stdout.on("data", (d) => note(`next: ${String(d).trim()}`));
  server.stderr.on("data", (d) => note(`next: ${String(d).trim()}`));
  server.on("exit", (code) => {
    note(`The server exited (${code}).`);
    server = null;
  });
}

function waitForServer(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(`${ORIGIN}/api/cron/status-probe`, () => resolve()).on("error", () => {
        if (Date.now() > deadline) return reject(new Error("The server did not start in time."));
        setTimeout(attempt, 500);
      });
      // Any HTTP answer at all means it is listening; a 401 or 404 is fine.
      req.on("response", () => resolve());
    };
    attempt();
  });
}

/* ==========================================================================
   The clock
   ========================================================================== */

/**
 * The fleet's schedule.
 *
 * Jobs are triggered over HTTP against the local server rather than by spawning
 * the CLI, so the server stays the only process that touches the database. The
 * hours are local: a channel that posts at 18:30 posts at 18:30 where its
 * audience is, which is where its operator is.
 */
const SCHEDULE = [
  // Each creator wakes early and makes the day's video: it has to exist, be
  // checked and be rendered well before its publishing slot, because a render
  // that fails at 18:25 for an 18:30 slot is a day lost.
  { job: "produce", at: "07:00", label: "each creator makes today's video" },
  // Publishing is separate from making, and runs often: a video is posted when
  // its own slot comes, not when it happens to be ready.
  { job: "publish", everyMinutes: 30, label: "anything whose slot has come" },
  // The decision grid needs numbers at 2h, 24h and 72h after each post, so the
  // metrics have to be pulled on a tighter clock than the posts are made.
  { job: "ingest", everyMinutes: 60, label: "metrics, then the verdicts" },
  // Late enough that the day's posts have their first numbers in.
  { job: "analyse", at: "23:30", label: "what the day taught, written to memory" },
  // The manager, once a week: it reads every channel's results and decides which
  // to keep, double, reposition, slow or stop.
  { job: "review", at: "09:00", weekday: 1, label: "the weekly fleet review" },
  { job: "warm", at: "03:00", label: "the warming ramp" },
];

const lastRun = new Map();

function trigger(job) {
  const secret = readEnvFile().CRON_SECRET ?? "";
  const url = `${ORIGIN}/api/cron/${job}${secret ? `?secret=${encodeURIComponent(secret)}` : ""}`;
  note(`→ ${job}`);
  http
    .get(url, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => note(`← ${job} ${res.statusCode}: ${body.slice(0, 300)}`));
    })
    .on("error", (e) => note(`← ${job} failed: ${e.message}`));
}

function tick() {
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  for (const entry of SCHEDULE) {
    const key = entry.job;
    const previous = lastRun.get(key) ?? 0;

    if (entry.everyMinutes) {
      if (Date.now() - previous >= entry.everyMinutes * 60_000) {
        lastRun.set(key, Date.now());
        trigger(entry.job);
      }
      continue;
    }

    if (entry.at !== hhmm) continue;
    if (entry.weekday !== undefined && now.getDay() !== entry.weekday) continue;
    // A minute is 60 ticks at this interval; only fire on the first one.
    if (Date.now() - previous < 90_000) continue;
    lastRun.set(key, Date.now());
    trigger(entry.job);
  }
}

/* ==========================================================================
   The window
   ========================================================================== */

function createWindow() {
  window_ = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#0B0B0C",
    icon: ICON,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  window_.loadURL(`${ORIGIN}/dashboard`);

  // Anything that is not the local app opens in the real browser — an OAuth
  // consent screen inside an Electron window is both a bad experience and,
  // for Google, a refused one.
  window_.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(ORIGIN)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  window_.on("closed", () => {
    window_ = null;
  });
}

function buildMenu() {
  const jobs = SCHEDULE.map((entry) => ({
    label: `Run ${entry.job} now — ${entry.label}`,
    click: () => trigger(entry.job),
  }));

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: "appMenu" },
      {
        label: "Fleet",
        submenu: [
          ...jobs,
          { type: "separator" },
          {
            label: "Show the log",
            click: () => {
              dialog.showMessageBox({
                type: "info",
                message: "Recent activity",
                detail: log.slice(-40).join("\n") || "Nothing yet.",
              });
            },
          },
        ],
      },
      { role: "editMenu" },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "toggleDevTools" },
          { type: "separator" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { role: "togglefullscreen" },
        ],
      },
      { role: "windowMenu" },
    ]),
  );
}

/* ==========================================================================
   Lifecycle
   ========================================================================== */

app.whenReady().then(async () => {
  if (process.platform === "darwin" && !ICON.isEmpty()) app.dock?.setIcon(ICON);
  buildMenu();
  startServer();

  try {
    await waitForServer();
    note("The server is up.");
  } catch (error) {
    note(String(error));
    dialog.showErrorBox("OttoUGC could not start", String(error));
  }

  createWindow();
  clock = setInterval(tick, 30_000);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (clock) clearInterval(clock);
  // The server owns the database. Give it a chance to close cleanly rather than
  // killing it mid-write, which is how the last database was lost.
  if (server) {
    note("Stopping the server.");
    server.kill("SIGTERM");
  }
});
