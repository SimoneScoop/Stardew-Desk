/* The few Win32 calls the Windows host needs, through koffi (no compiler, no native
 * build step). Everything here is a no-op on other systems, so the host can be run
 * and tested on Linux / macOS too.
 *
 *   attach(hwnd, rect)  put a window on the desktop: above the wallpaper, below the icons
 *   windowRects()       ordinary app windows on screen (for "how much of the farm is hidden")
 *   coveredAt(x, y)     is that point over a window, or over the bare desktop?
 *   mouseDown()         is the left mouse button held right now?
 *   foregroundFullscreen(rect)  is the active window covering this display (a video, a game)?
 *
 * Coordinates are physical pixels (Electron is per-monitor DPI aware). */
'use strict';

const WIN = process.platform === 'win32';
let api = null;

function load() {
  if (api || !WIN) return api;
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  const dwmapi = koffi.load('dwmapi.dll');
  const POINT = koffi.struct('POINT', { x: 'int32_t', y: 'int32_t' });
  const RECT = koffi.struct('RECT', { left: 'int32_t', top: 'int32_t', right: 'int32_t', bottom: 'int32_t' });
  const EnumProc = koffi.proto('bool __stdcall SDVEnumProc(intptr_t hwnd, intptr_t lParam)');
  api = {
    koffi, POINT, RECT,
    FindWindowW: user32.func('intptr_t __stdcall FindWindowW(str16 cls, str16 name)'),
    FindWindowExW: user32.func('intptr_t __stdcall FindWindowExW(intptr_t parent, intptr_t after, str16 cls, str16 name)'),
    SendMessageTimeoutW: user32.func('intptr_t __stdcall SendMessageTimeoutW(intptr_t hwnd, uint32_t msg, uintptr_t wp, intptr_t lp, uint32_t flags, uint32_t timeout, void *result)'),
    EnumWindows: user32.func('bool __stdcall EnumWindows(SDVEnumProc *cb, intptr_t lParam)'),
    SetParent: user32.func('intptr_t __stdcall SetParent(intptr_t child, intptr_t parent)'),
    GetParent: user32.func('intptr_t __stdcall GetParent(intptr_t hwnd)'),
    IsWindow: user32.func('bool __stdcall IsWindow(intptr_t hwnd)'),
    IsWindowVisible: user32.func('bool __stdcall IsWindowVisible(intptr_t hwnd)'),
    IsIconic: user32.func('bool __stdcall IsIconic(intptr_t hwnd)'),
    SetWindowPos: user32.func('bool __stdcall SetWindowPos(intptr_t hwnd, intptr_t after, int x, int y, int cx, int cy, uint32_t flags)'),
    GetWindowLongPtrW: user32.func('intptr_t __stdcall GetWindowLongPtrW(intptr_t hwnd, int index)'),
    SetWindowLongPtrW: user32.func('intptr_t __stdcall SetWindowLongPtrW(intptr_t hwnd, int index, intptr_t value)'),
    SetLayeredWindowAttributes: user32.func('bool __stdcall SetLayeredWindowAttributes(intptr_t hwnd, uint32_t key, uint8_t alpha, uint32_t flags)'),
    GetSystemMetrics: user32.func('int __stdcall GetSystemMetrics(int index)'),
    WindowFromPoint: user32.func('intptr_t __stdcall WindowFromPoint(POINT pt)'),
    GetAncestor: user32.func('intptr_t __stdcall GetAncestor(intptr_t hwnd, uint32_t flags)'),
    GetClassNameW: user32.func('int __stdcall GetClassNameW(intptr_t hwnd, uint16_t *buf, int max)'),
    GetWindowRect: user32.func('bool __stdcall GetWindowRect(intptr_t hwnd, _Out_ RECT *rect)'),
    GetForegroundWindow: user32.func('intptr_t __stdcall GetForegroundWindow()'),
    GetAsyncKeyState: user32.func('int16_t __stdcall GetAsyncKeyState(int key)'),
    DwmGetWindowAttribute: dwmapi.func('int32_t __stdcall DwmGetWindowAttribute(intptr_t hwnd, uint32_t attr, _Out_ uint32_t *value, uint32_t size)'),
  };
  return api;
}

// ---------- helpers ----------
const n = v => Number(v || 0);          // handles come back as numbers (or BigInt on odd builds)
function hwndOf(win) {
  const buf = win.getNativeWindowHandle();
  return buf.length >= 8 ? Number(buf.readBigUInt64LE(0)) : buf.readUInt32LE(0);
}
function className(h) {
  const a = load();
  const buf = new Uint16Array(256);
  const len = a.GetClassNameW(h, buf, 256);
  return len > 0 ? String.fromCharCode(...buf.subarray(0, len)) : '';
}
function rectOf(h) {
  const a = load();
  const r = {};
  if (!a.GetWindowRect(h, r)) return null;
  return { x: r.left, y: r.top, w: r.right - r.left, h: r.bottom - r.top };
}
function cloaked(h) {
  const a = load();
  const out = [0];
  try { return a.DwmGetWindowAttribute(h, 14 /* DWMWA_CLOAKED */, out, 4) === 0 && out[0] !== 0; } catch { return false; }
}

// ---------- the desktop layer ----------
const GWL_STYLE = -16, GWL_EXSTYLE = -20;
const WS_CHILD = 0x40000000, WS_POPUP = 0x80000000, WS_CAPTION = 0x00C00000, WS_THICKFRAME = 0x00040000;
const WS_EX_LAYERED = 0x80000, WS_EX_TOOLWINDOW = 0x80, WS_EX_TRANSPARENT = 0x20, WS_EX_NOACTIVATE = 0x08000000;
const SWP_NOSIZE = 1, SWP_NOMOVE = 2, SWP_NOZORDER = 4, SWP_NOACTIVATE = 0x10, SWP_SHOWWINDOW = 0x40, SWP_FRAMECHANGED = 0x20;
const DESKTOP_CLASSES = new Set(['Progman', 'WorkerW']);

// Find where wallpapers live. Explorer makes a WorkerW behind the icons when Progman gets
// message 0x052C. Up to Windows 11 23H2 it's a top-level window right after the one that
// holds the icons (SHELLDLL_DefView); from 24H2 on it's a child of Progman, below the icons.
function findDesktop() {
  const a = load();
  const progman = n(a.FindWindowW('Progman', null));
  if (!progman) return null;
  a.SendMessageTimeoutW(progman, 0x052C, 0xD, 0x1, 0, 1000, null);
  a.SendMessageTimeoutW(progman, 0x052C, 0, 0, 0, 1000, null);
  let workerw = 0;
  a.EnumWindows((top) => {
    if (n(a.FindWindowExW(top, 0, 'SHELLDLL_DefView', null))) workerw = n(a.FindWindowExW(0, top, 'WorkerW', null));
    return true;
  }, 0);
  if (workerw) return { mode: 'workerw', parent: workerw, after: 0, progman };
  const defView = n(a.FindWindowExW(progman, 0, 'SHELLDLL_DefView', null));
  return { mode: 'progman', parent: progman, after: defView, progman };
}

// rect: the display in physical pixels. how: 'auto' | 'nolayer' (24H2 without WS_EX_LAYERED)
// | 'window' (don't touch the desktop; a plain window kept at the bottom). Returns info or null.
function attach(win, rect, how) {
  if (!WIN) return null;
  const a = load();
  const hwnd = hwndOf(win);
  if (how === 'window') { toBottom(hwnd); return { mode: 'window', parent: 0, hwnd }; }
  const d = findDesktop();
  if (!d) return null;
  let style = n(a.GetWindowLongPtrW(hwnd, GWL_STYLE));
  style = (style & ~(WS_POPUP | WS_CAPTION | WS_THICKFRAME)) | WS_CHILD;
  a.SetWindowLongPtrW(hwnd, GWL_STYLE, style);
  let ex = n(a.GetWindowLongPtrW(hwnd, GWL_EXSTYLE)) | WS_EX_NOACTIVATE;
  const layered = d.mode === 'progman' && how !== 'nolayer';   // 24H2: Progman's children must be layered to be drawn
  if (layered) ex |= WS_EX_LAYERED;
  a.SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex);
  if (layered) a.SetLayeredWindowAttributes(hwnd, 0, 255, 2 /* LWA_ALPHA */);
  a.SetParent(hwnd, d.parent);
  const vx = a.GetSystemMetrics(76), vy = a.GetSystemMetrics(77);   // virtual screen origin: the parent's (0, 0)
  const flags = SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_FRAMECHANGED | (d.after ? 0 : SWP_NOZORDER);
  a.SetWindowPos(hwnd, d.after || 0, rect.x - vx, rect.y - vy, rect.w, rect.h, flags);
  return { mode: d.mode, parent: d.parent, hwnd };
}
// Plain-window fallback: keep it under every other window.
function toBottom(hwnd) {
  load().SetWindowPos(hwnd, 1 /* HWND_BOTTOM */, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
}
// Still where we put it? (Explorer restarting takes the WorkerW with it.)
function attached(info) {
  if (!WIN || !info) return true;
  if (info.mode === 'window') { toBottom(info.hwnd); return true; }
  const a = load();
  return a.IsWindow(info.parent) && n(a.GetParent(info.hwnd)) === info.parent;
}

// ---------- what's on screen ----------
// Visible top-level app windows (not ours, not the desktop / taskbar, not invisible overlays).
function windowRects(own) {
  if (!WIN) return [];
  const a = load();
  const out = [];
  a.EnumWindows((h) => {
    if (own.has(h) || !a.IsWindowVisible(h) || a.IsIconic(h) || cloaked(h)) return true;
    const ex = n(a.GetWindowLongPtrW(h, GWL_EXSTYLE));
    if (ex & (WS_EX_TOOLWINDOW | WS_EX_TRANSPARENT)) return true;
    const cls = className(h);
    if (DESKTOP_CLASSES.has(cls) || cls === 'Shell_TrayWnd' || cls === 'Shell_SecondaryTrayWnd') return true;
    const r = rectOf(h);
    if (r && r.w > 1 && r.h > 1) { r.cls = cls; out.push(r); }
    return true;
  }, 0);
  return out;
}
// Over a window (1), or over the bare desktop / our farm (0)?
function coveredAt(x, y, own) {
  if (!WIN) return false;
  const a = load();
  const h = n(a.WindowFromPoint({ x: Math.round(x), y: Math.round(y) }));
  if (!h) return false;
  const root = n(a.GetAncestor(h, 2 /* GA_ROOT */));
  if (own.has(root)) return false;
  return !DESKTOP_CLASSES.has(className(root));
}
function mouseDown() {
  if (!WIN) return false;
  return (load().GetAsyncKeyState(0x01) & 0x8000) !== 0;
}
// The active window fills this display (a full-screen video or game): don't start the saver over it.
function foregroundFullscreen(rect, own) {
  if (!WIN) return false;
  const a = load();
  const h = n(a.GetForegroundWindow());
  if (!h || own.has(h)) return false;
  if (DESKTOP_CLASSES.has(className(h))) return false;
  const r = rectOf(h);
  return Boolean(r && r.x <= rect.x && r.y <= rect.y && r.x + r.w >= rect.x + rect.w && r.y + r.h >= rect.y + rect.h);
}

module.exports = { WIN, hwndOf, attach, attached, windowRects, coveredAt, mouseDown, foregroundFullscreen };
