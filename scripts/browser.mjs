/**
 * A tiny headless-Chrome driver over the DevTools protocol, for checking the
 * game in a real browser without a visible window: load a page, run script in
 * it, emulate a phone, take screenshots.
 *
 *   node scripts/browser.mjs <plan.mjs> [outDir]
 *
 * A plan is a module whose default export is `async (page) => {}`; `page` has
 * goto(url), wait(ms), eval(js), shot(name), mobile(width, height), desktop(width, height),
 * console (the collected console lines). Screenshots go to outDir (default ./shots).
 * Uses Chrome (or Edge) from the standard install paths; override with CHROME=path.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import WebSocket from 'ws';

const CANDIDATES = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const launch = async (outDir = 'shots', port = 9300 + Math.floor(Math.random() * 600)) => {
  const exe = CANDIDATES.find((p) => existsSync(p));
  if (!exe) throw new Error('no Chrome/Edge found (set CHROME=)');
  mkdirSync(outDir, { recursive: true });
  const profile = mkdtempSync(join(tmpdir(), 'ils-chrome-'));
  const chrome = spawn(
    exe,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--window-size=1600,900',
      '--ignore-gpu-blocklist',
      '--enable-unsafe-swiftshader',
      '--use-angle=swiftshader',
      '--autoplay-policy=no-user-gesture-required',
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  // NEVER LEAVE A CHROME BEHIND. A run that is killed from outside (a timeout,
  // Ctrl+C, a stopped agent) skips every `finally`, and an orphaned headless
  // Chrome keeps burning a CPU core: dozens of them made every later render
  // take seconds. So the browser dies with this process however it ends, and
  // its throwaway profile goes with it.
  let gone = false;
  const reap = () => {
    if (gone) return;
    gone = true;
    try {
      chrome.kill();
    } catch {
      /* already dead */
    }
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch {
      /* Chrome may still hold a file for a moment; the OS temp cleaner gets it */
    }
  };
  process.once('exit', reap);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.once(signal, () => {
      reap();
      process.exit(130);
    });
  }
  let version = null;
  for (let i = 0; i < 60 && !version; i += 1) {
    await sleep(250);
    try {
      version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    } catch {
      /* not up yet */
    }
  }
  if (!version) {
    reap();
    throw new Error('Chrome did not open its debugging port');
  }
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.once('open', r);
    ws.once('error', j);
  });
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.on('message', (data) => {
    const msg = JSON.parse(String(data));
    if (msg.id && pending.has(msg.id)) {
      const { resolve: ok, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else ok(msg.result);
    } else if (msg.method) {
      for (const l of listeners) l(msg);
    }
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((ok, reject) => {
      id += 1;
      pending.set(id, { resolve: ok, reject });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const s = (method, params) => send(method, params, sessionId);
  await s('Page.enable');
  await s('Runtime.enable');
  const consoleLines = [];
  listeners.push((msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
      consoleLines.push(`[${msg.params.type}] ${text}`);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      consoleLines.push(`[exception] ${msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text}`);
    }
  });
  const page = {
    console: consoleLines,
    async goto(url) {
      await s('Page.navigate', { url });
      await sleep(400);
    },
    wait: sleep,
    async eval(expression) {
      const result = await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result.value;
    },
    async shot(name) {
      const { data } = await s('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
      const file = resolve(outDir, `${name}.jpg`);
      writeFileSync(file, Buffer.from(data, 'base64'));
      return file;
    },
    async mobile(width = 844, height = 390) {
      await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
      await s('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await s('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });
      await s('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }, { name: 'any-pointer', value: 'coarse' }, { name: 'any-hover', value: 'none' }] });
      await s('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' });
    },
    async desktop(width = 1600, height = 900) {
      await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await s('Emulation.setTouchEmulationEnabled', { enabled: false });
      await s('Emulation.setEmulatedMedia', { features: [] });
    },
    /** A real touch tap at CSS pixel coordinates. */
    async tap(x, y) {
      await s('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await sleep(60);
      await s('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    },
    async key(code, type = 'press') {
      const events = type === 'press' ? ['keyDown', 'keyUp'] : [type];
      for (const t of events) await s('Input.dispatchKeyEvent', { type: t, code, key: code.replace(/^Key/, '').toLowerCase(), windowsVirtualKeyCode: code.startsWith('Key') ? code.charCodeAt(3) : 0 });
    },
  };
  const close = async () => {
    try {
      await send('Browser.close');
    } catch {
      /* already gone */
    }
    ws.close();
    await sleep(150);
    reap();
  };
  return { page, close };
};

// CLI: node scripts/browser.mjs plan.mjs [outDir]
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const planPath = process.argv[2];
  if (!planPath) {
    console.error('usage: node scripts/browser.mjs <plan.mjs> [outDir]');
    process.exit(2);
  }
  const outDir = process.argv[3] ?? 'shots';
  const { page, close } = await launch(outDir);
  let code = 0;
  // A plan that hangs (a page that never loads, an eval that never returns)
  // ends here instead of holding a browser for ever. PLAN_TIMEOUT_MS overrides.
  const limit = Number(process.env.PLAN_TIMEOUT_MS ?? 240_000);
  const watchdog = setTimeout(() => {
    console.error(`plan timed out after ${limit / 1000}s`);
    void close().finally(() => process.exit(1));
  }, limit);
  try {
    const plan = (await import(pathToFileURL(resolve(planPath)).href)).default;
    const result = await plan(page);
    if (result !== undefined) console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('plan failed:', error);
    code = 1;
  } finally {
    const errors = page.console.filter((l) => l.startsWith('[error]') || l.startsWith('[exception]'));
    if (errors.length) console.log(`console errors:\n  ${errors.slice(0, 20).join('\n  ')}`);
    clearTimeout(watchdog);
    await close();
  }
  process.exit(code);
}
