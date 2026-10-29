// Live site: ONE native WebView2 child webview laid over a board card, so a web page can be used
// (scrolled, clicked) inside the card even when the site refuses to be framed. The renderer owns the
// geometry (it knows where the card is on screen) and the lifecycle (docs/architecture.md).
//
// Isolation: the child webview gets its own data directory and runs InPrivate, so it shares no
// cookie or storage with the app shell; no capability names the `livesite` label and the page is a
// remote origin, so Tauri IPC is denied to it. Navigation is restricted to http(s).
//
// Ad blocking: the Brave `adblock` engine (MPL-2.0) fed by EasyList + EasyPrivacy, DOWNLOADED on first
// use into the app cache dir (never bundled) and refreshed at most weekly (or on demand). The engine
// is built on a background task; until it is ready — or if the lists cannot be fetched — nothing is
// blocked and opening a site never fails because of it. ONE engine serves three webviews:
//   - `livesite`  the live card (blocked requests are counted, per-host allowlist honoured),
//   - `livesnap`  the hidden picture-taking webview (same rules, nothing counted),
//   - `main`      the board itself, third-party requests of embedded frames only (see `main_blocks`).
// One master switch (`adblock_set_enabled`, default on, persisted as a marker file) turns all three off.
//
// Picture-taking (`livesite_snapshot`): WebView2 `CapturePreview` renders from the compositor, so the
// controller must stay VISIBLE (a hidden controller yields nothing). The snapshot webview is therefore
// "shown" but placed entirely outside the window's client area, where the parent window clips it: the
// user never sees it and the page still renders at the requested size.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, SystemTime};

use serde::Serialize;
use tauri::webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder};
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Position, Rect, Size, Url, WebviewUrl,
};

const LABEL: &str = "livesite";
const SNAP_LABEL: &str = "livesnap";
const FILTER_LISTS: [(&str, &str); 2] = [
    ("easylist.txt", "https://easylist.to/easylist/easylist.txt"),
    ("easyprivacy.txt", "https://easylist.to/easylist/easyprivacy.txt"),
];
const LIST_MAX_AGE: Duration = Duration::from_secs(7 * 24 * 3600);
const DISABLED_MARKER: &str = "adblock-disabled";

static ENGINE: RwLock<Option<Arc<adblock::Engine>>> = RwLock::new(None);
static ENGINE_STARTED: AtomicBool = AtomicBool::new(false);
static ENABLED: AtomicBool = AtomicBool::new(true);
static LOADING: AtomicBool = AtomicBool::new(false);
static BLOCKED_LIVE: AtomicU32 = AtomicU32::new(0);
static BLOCKED_MAIN: AtomicU32 = AtomicU32::new(0);
static SNAP_BUSY: AtomicBool = AtomicBool::new(false);
static TITLE: Mutex<String> = Mutex::new(String::new());
static ALLOW: RwLock<Vec<String>> = RwLock::new(Vec::new());
static SNAP_LOADED: Mutex<Option<tokio::sync::oneshot::Sender<()>>> = Mutex::new(None);

#[derive(Clone, Copy, PartialEq, Eq)]
enum Target {
    Live,
    Snap,
    Main,
}

fn parse_http_url(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw.trim()).map_err(|e| format!("invalid url: {e}"))?;
    match url.scheme() {
        "http" | "https" => Ok(url),
        other => Err(format!("unsupported scheme: {other}")),
    }
}

fn rect(x: f64, y: f64, w: f64, h: f64) -> Rect {
    Rect {
        position: Position::Logical(LogicalPosition::new(x, y)),
        size: Size::Logical(LogicalSize::new(w.max(1.0), h.max(1.0))),
    }
}

// ── Host helpers (pure) ─────────────────────────────────────────────────────────────────────────

fn host_of(raw: &str) -> Option<String> {
    Url::parse(raw)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.trim_start_matches("www.").to_ascii_lowercase()))
}

// An allowlist entry matches its own host and every subdomain of it.
fn host_matches(list: &[String], host: &str) -> bool {
    let host = host.trim_start_matches("www.");
    list.iter().any(|entry| {
        let entry = entry.trim().trim_start_matches("www.");
        !entry.is_empty() && (host == entry || host.ends_with(&format!(".{entry}")))
    })
}

// Hosts the main-webview filter NEVER touches: the app itself, its backend, sign-in, and the players
// that must keep working untouched.
fn is_excluded_host(host: &str) -> bool {
    const EXACT: [&str; 3] = ["localhost", "127.0.0.1", "[::1]"];
    const SUFFIX: [&str; 12] = [
        "localhost",
        "convex.cloud",
        "convex.site",
        "discord.com",
        "discordapp.com",
        "discord.gg",
        "googleapis.com",
        "gstatic.com",
        "youtube-nocookie.com",
        "youtube.com",
        "ytimg.com",
        "googlevideo.com",
    ];
    EXACT.contains(&host)
        || SUFFIX.iter().any(|s| host == *s || host.ends_with(&format!(".{s}")))
}

// Registrable-domain approximation (last two labels, three under a short country second level).
fn site_key(host: &str) -> String {
    let labels: Vec<&str> = host.split('.').collect();
    let n = labels.len();
    if n <= 2 {
        return host.to_string();
    }
    let second_level = matches!(labels[n - 2], "co" | "com" | "org" | "net" | "gov" | "ac" | "edu");
    let take = if second_level && labels[n - 1].len() == 2 { 3 } else { 2 };
    labels[n - take.min(n)..].join(".")
}

fn same_site(a: &str, b: &str) -> bool {
    site_key(a) == site_key(b)
}

// ── Filter lists ────────────────────────────────────────────────────────────────────────────────

fn lists_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_cache_dir().ok().map(|d| d.join("livesite-filters"))
}

fn is_fresh(path: &std::path::Path) -> bool {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| SystemTime::now().duration_since(t).ok())
        .map(|age| age < LIST_MAX_AGE)
        .unwrap_or(false)
}

async fn refresh_lists(dir: &std::path::Path, force: bool) {
    let _ = std::fs::create_dir_all(dir);
    let Ok(client) = reqwest::Client::builder().timeout(Duration::from_secs(40)).build() else {
        return;
    };
    for (name, url) in FILTER_LISTS {
        let path = dir.join(name);
        if !force && is_fresh(&path) {
            continue;
        }
        // A failed refresh keeps the stale copy, if any.
        let Ok(resp) = client.get(url).send().await else { continue };
        if !resp.status().is_success() {
            continue;
        }
        let Ok(text) = resp.text().await else { continue };
        // Sanity check: an HTML error page must not replace a good list.
        if text.len() > 10_000 && text.trim_start().starts_with('[') {
            let tmp = dir.join(format!("{name}.tmp"));
            if std::fs::write(&tmp, text).is_ok() {
                let _ = std::fs::rename(&tmp, &path);
            }
        }
    }
}

fn build_engine(dir: &std::path::Path) -> Option<adblock::Engine> {
    let mut set = adblock::lists::FilterSet::new(false);
    let mut any = false;
    let opts = adblock::lists::ParseOptions {
        rule_types: adblock::lists::RuleTypes::NetworkOnly,
        ..Default::default()
    };
    for (name, _) in FILTER_LISTS {
        if let Ok(text) = std::fs::read_to_string(dir.join(name)) {
            set.add_filter_list(text, opts);
            any = true;
        }
    }
    any.then(|| adblock::Engine::new_with_filter_set(set))
}

async fn rebuild_engine(dir: PathBuf, force: bool) {
    refresh_lists(&dir, force).await;
    let built = tauri::async_runtime::spawn_blocking(move || build_engine(&dir)).await;
    if let Ok(Some(engine)) = built {
        if let Ok(mut slot) = ENGINE.write() {
            *slot = Some(Arc::new(engine));
        }
    }
}

fn engine_ready() -> bool {
    ENGINE.read().map(|e| e.is_some()).unwrap_or(false)
}

// Starts (once per process) the background download + engine build.
fn ensure_engine(app: &AppHandle) {
    if ENGINE_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    let Some(dir) = lists_dir(app) else { return };
    tauri::async_runtime::spawn(rebuild_engine(dir, false));
}

#[cfg(windows)]
fn adblock_type(context: i32) -> &'static str {
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    match COREWEBVIEW2_WEB_RESOURCE_CONTEXT(context) {
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_DOCUMENT => "sub_frame",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_STYLESHEET => "stylesheet",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE => "image",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA => "media",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FONT => "font",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SCRIPT => "script",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_XML_HTTP_REQUEST
        | COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FETCH => "xhr",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_WEBSOCKET => "websocket",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_PING => "ping",
        _ => "other",
    }
}

fn engine_blocks(url: &str, source: &str, request_type: &str) -> bool {
    let Some(engine) = ENGINE.read().ok().and_then(|e| e.clone()) else { return false };
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return false;
    }
    match adblock::request::Request::new(url, source, request_type, "GET") {
        Ok(req) => engine.check_network_request(&req).should_block(),
        Err(_) => false,
    }
}

// Live card / snapshot: the page URL is the source; a host on the allowlist is never filtered.
#[cfg(windows)]
fn page_blocks(url: &str, source: &str, request_type: &str) -> bool {
    if !ENABLED.load(Ordering::Relaxed) {
        return false;
    }
    if let Some(host) = host_of(source) {
        if ALLOW.read().map(|l| host_matches(&l, &host)).unwrap_or(false) {
            return false;
        }
    }
    engine_blocks(url, source, request_type)
}

// Main board webview. Strictest rule set of the three: a request is blocked only when ALL hold:
//  - the master switch is on and the engine matches the request;
//  - the request host is not excluded (app, localhost, Convex, Discord, Google fonts/APIs, YouTube);
//  - the request carries a Referer (so it comes from inside an embedded frame, not from the app's
//    own document, whose requests either lack it or carry the app origin);
//  - the Referer host is not excluded either (never touch what a YouTube/app frame loads);
//  - request and Referer are NOT the same site (third-party only).
#[cfg(windows)]
fn main_blocks(url: &str, referer: &str, request_type: &str) -> bool {
    if !ENABLED.load(Ordering::Relaxed) || referer.is_empty() {
        return false;
    }
    let (Some(req_host), Some(ref_host)) = (host_of(url), host_of(referer)) else { return false };
    if is_excluded_host(&req_host) || is_excluded_host(&ref_host) || same_site(&req_host, &ref_host) {
        return false;
    }
    engine_blocks(url, referer, request_type)
}

// Hooks WebResourceRequested on a webview's CoreWebView2: a blocked request gets an empty 403.
#[cfg(windows)]
fn install_blocking(webview: &tauri::Webview, target: Target) {
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use webview2_com::{take_pwstr, WebResourceRequestedEventHandler};
    use windows::core::{w, PWSTR};
    use windows::Win32::System::Com::StructuredStorage::CreateStreamOnHGlobal;

    let _ = webview.with_webview(move |platform| unsafe {
        let Ok(core) = platform.controller().CoreWebView2() else { return };
        let env = platform.environment().clone();
        let handler = WebResourceRequestedEventHandler::create(Box::new(move |sender, args| {
            if !ENABLED.load(Ordering::Relaxed) {
                return Ok(());
            }
            let (Some(sender), Some(args)) = (sender, args) else { return Ok(()) };
            let request = args.Request()?;
            let mut uri = PWSTR::null();
            request.Uri(&mut uri)?;
            let uri = take_pwstr(uri);
            let mut ctx = COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL;
            args.ResourceContext(&mut ctx)?;
            let kind = adblock_type(ctx.0);
            let blocked = if target == Target::Main {
                // Cheap early-out before touching headers: the app's own traffic.
                if host_of(&uri).map(|h| is_excluded_host(&h)).unwrap_or(true) {
                    return Ok(());
                }
                let mut referer = String::new();
                if let Ok(headers) = request.Headers() {
                    let mut p = PWSTR::null();
                    if headers.GetHeader(w!("Referer"), &mut p).is_ok() && !p.is_null() {
                        referer = take_pwstr(p);
                    }
                }
                main_blocks(&uri, &referer, kind)
            } else {
                let mut src = PWSTR::null();
                let source = if sender.Source(&mut src).is_ok() && !src.is_null() {
                    take_pwstr(src)
                } else {
                    String::new()
                };
                page_blocks(&uri, &source, kind)
            };
            if blocked {
                match target {
                    Target::Live => {
                        BLOCKED_LIVE.fetch_add(1, Ordering::Relaxed);
                    }
                    Target::Main => {
                        BLOCKED_MAIN.fetch_add(1, Ordering::Relaxed);
                    }
                    Target::Snap => {}
                }
                let empty = CreateStreamOnHGlobal(Default::default(), true)?;
                let response = env.CreateWebResourceResponse(&empty, 403, w!("Blocked"), w!(""))?;
                args.SetResponse(&response)?;
            }
            Ok(())
        }));
        let mut token = 0i64;
        if target == Target::Main {
            // Frames, scripts, media and background requests only: the board's own images, styles
            // and fonts never reach the handler.
            for ctx in [
                COREWEBVIEW2_WEB_RESOURCE_CONTEXT_DOCUMENT,
                COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SCRIPT,
                COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA,
                COREWEBVIEW2_WEB_RESOURCE_CONTEXT_XML_HTTP_REQUEST,
                COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FETCH,
            ] {
                let _ = core.AddWebResourceRequestedFilter(w!("*"), ctx);
            }
        } else {
            let _ = core.AddWebResourceRequestedFilter(w!("*"), COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL);
        }
        let _ = core.add_WebResourceRequested(&handler, &mut token);
    });
}

#[cfg(not(windows))]
fn install_blocking(_webview: &tauri::Webview, _target: Target) {}

/// Startup hook (lib.rs setup): restores the master switch, starts the lists and filters the board's
/// own webview. Best-effort: it never fails the app start.
pub fn init_main_blocking(app: &AppHandle) {
    if let Some(dir) = lists_dir(app) {
        if dir.join(DISABLED_MARKER).exists() {
            ENABLED.store(false, Ordering::Relaxed);
        }
    }
    ensure_engine(app);
    if let Some(wv) = app.get_webview("main") {
        install_blocking(&wv, Target::Main);
    }
}

// ── Commands ────────────────────────────────────────────────────────────────────────────────────
// All `async`: `Window::add_child` blocks on the main thread, so a synchronous command (which runs
// there) would deadlock.

fn profile_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("livesite-profile"))
}

#[tauri::command]
pub async fn livesite_open(
    app: AppHandle,
    url: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<(), String> {
    let target = parse_http_url(&url)?;
    ensure_engine(&app);

    if let Some(existing) = app.get_webview(LABEL) {
        existing.set_bounds(rect(x, y, w, h)).map_err(|e| e.to_string())?;
        existing.show().map_err(|e| e.to_string())?;
        if existing.url().ok().as_ref() != Some(&target) {
            existing.navigate(target).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }

    BLOCKED_LIVE.store(0, Ordering::Relaxed);
    LOADING.store(true, Ordering::Relaxed);
    if let Ok(mut t) = TITLE.lock() {
        t.clear();
    }
    let window = app.get_window("main").ok_or("main window not found")?;
    let profile = profile_dir(&app)?;
    let handle = app.clone();
    let builder = WebviewBuilder::new(LABEL, WebviewUrl::External(target))
        .data_directory(profile)
        .incognito(true)
        .on_navigation(|u| matches!(u.scheme(), "http" | "https" | "about"))
        .on_page_load(|_, payload| match payload.event() {
            // A new page starts counting from zero.
            PageLoadEvent::Started => {
                LOADING.store(true, Ordering::Relaxed);
                BLOCKED_LIVE.store(0, Ordering::Relaxed);
            }
            PageLoadEvent::Finished => LOADING.store(false, Ordering::Relaxed),
        })
        .on_document_title_changed(|_, title| {
            if let Ok(mut t) = TITLE.lock() {
                *t = title;
            }
        })
        .on_new_window(move |u, _| {
            // A popup stays in the card: navigate the live webview instead of opening a window.
            if matches!(u.scheme(), "http" | "https") {
                let h = handle.clone();
                std::thread::spawn(move || {
                    if let Some(wv) = h.get_webview(LABEL) {
                        let _ = wv.navigate(u);
                    }
                });
            }
            NewWindowResponse::Deny
        });
    let r = rect(x, y, w, h);
    let webview = window
        .add_child(builder, r.position, r.size)
        .map_err(|e| e.to_string())?;
    install_blocking(&webview, Target::Live);
    Ok(())
}

#[tauri::command]
pub async fn livesite_bounds(app: AppHandle, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
    match app.get_webview(LABEL) {
        Some(wv) => wv.set_bounds(rect(x, y, w, h)).map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

#[tauri::command]
pub async fn livesite_visible(app: AppHandle, visible: bool) -> Result<(), String> {
    match app.get_webview(LABEL) {
        Some(wv) => (if visible { wv.show() } else { wv.hide() }).map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

#[tauri::command]
pub async fn livesite_nav(app: AppHandle, action: String) -> Result<(), String> {
    let wv = app.get_webview(LABEL).ok_or("no live site")?;
    #[cfg(windows)]
    {
        wv.with_webview(move |platform| unsafe {
            if let Ok(core) = platform.controller().CoreWebView2() {
                let _ = match action.as_str() {
                    "back" => core.GoBack(),
                    "forward" => core.GoForward(),
                    _ => core.Reload(),
                };
            }
        })
        .map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        let _ = (wv, action);
        Err("unsupported platform".into())
    }
}

// Navigates the live card to a typed address. Only http(s); the renderer already normalises it.
#[tauri::command]
pub async fn livesite_goto(app: AppHandle, url: String) -> Result<(), String> {
    let target = parse_http_url(&url)?;
    let wv = app.get_webview(LABEL).ok_or("no live site")?;
    wv.navigate(target).map_err(|e| e.to_string())
}

// Current page URL (after redirects / in-card navigation), so the renderer can offer "open in browser".
#[tauri::command]
pub async fn livesite_url(app: AppHandle) -> Result<String, String> {
    let wv = app.get_webview(LABEL).ok_or("no live site")?;
    wv.url().map(|u| u.to_string()).map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveInfo {
    url: Option<String>,
    title: String,
    loading: bool,
    // Requests the ad blocker refused on the CURRENT page of the live card.
    blocked: u32,
    // Master switch state and whether the filter lists are loaded yet.
    enabled: bool,
    ready: bool,
}

// Polled by the live toolbar: address, title, loading state and the ad-block counter in one call.
#[tauri::command]
pub async fn livesite_info(app: AppHandle) -> Result<LiveInfo, String> {
    let url = app.get_webview(LABEL).and_then(|wv| wv.url().ok()).map(|u| u.to_string());
    Ok(LiveInfo {
        url,
        title: TITLE.lock().map(|t| t.clone()).unwrap_or_default(),
        loading: LOADING.load(Ordering::Relaxed),
        blocked: BLOCKED_LIVE.load(Ordering::Relaxed),
        enabled: ENABLED.load(Ordering::Relaxed),
        ready: engine_ready(),
    })
}

// Hosts (and their subdomains) on which the live card and the snapshots do NOT filter. The renderer
// owns the list (localStorage) and pushes it here on open and on every change.
#[tauri::command]
pub async fn livesite_allow(hosts: Vec<String>) -> Result<(), String> {
    let clean: Vec<String> = hosts
        .into_iter()
        .map(|h| h.trim().to_ascii_lowercase())
        .filter(|h| !h.is_empty() && h.len() < 256)
        .take(500)
        .collect();
    if let Ok(mut list) = ALLOW.write() {
        *list = clean;
    }
    Ok(())
}

// PNG of a webview as it renders now (WebView2 CapturePreview).
#[cfg(windows)]
async fn capture_png(wv: &tauri::Webview) -> Result<Vec<u8>, String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG;
    use webview2_com::CapturePreviewCompletedHandler;
    use windows::Win32::System::Com::StructuredStorage::CreateStreamOnHGlobal;
    use windows::Win32::System::Com::{IStream, STATFLAG_NONAME, STATSTG, STREAM_SEEK_SET};

    let (tx, rx) = tokio::sync::oneshot::channel::<Result<Vec<u8>, String>>();
    let started = wv.with_webview(move |platform| unsafe {
        let tx = std::cell::RefCell::new(Some(tx));
        let send = move |res: Result<Vec<u8>, String>| {
            if let Some(t) = tx.borrow_mut().take() {
                let _ = t.send(res);
            }
        };
        let begin = || -> windows::core::Result<()> {
            let core = platform.controller().CoreWebView2()?;
            let stream: IStream = CreateStreamOnHGlobal(Default::default(), true)?;
            let read_from = stream.clone();
            let send = std::rc::Rc::new(send);
            let send_done = send.clone();
            let handler = CapturePreviewCompletedHandler::create(Box::new(move |res| {
                let out = res.map_err(|e| e.to_string()).and_then(|_| {
                    read_from.Seek(0, STREAM_SEEK_SET, None).map_err(|e| e.to_string())?;
                    let mut stat = STATSTG::default();
                    read_from.Stat(&mut stat, STATFLAG_NONAME).map_err(|e| e.to_string())?;
                    let mut buf = vec![0u8; stat.cbSize as usize];
                    let mut read = 0u32;
                    read_from
                        .Read(buf.as_mut_ptr().cast(), buf.len() as u32, Some(&mut read))
                        .ok()
                        .map_err(|e| e.to_string())?;
                    buf.truncate(read as usize);
                    Ok(buf)
                });
                send_done(out);
                Ok(())
            }));
            let started =
                core.CapturePreview(COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG, &stream, &handler);
            if let Err(e) = &started {
                send(Err(e.to_string()));
            }
            started
        };
        let _ = begin();
    });
    started.map_err(|e| e.to_string())?;
    let bytes = tokio::time::timeout(Duration::from_secs(10), rx)
        .await
        .map_err(|_| "capture timed out".to_string())?
        .map_err(|_| "capture cancelled".to_string())??;
    if bytes.is_empty() {
        return Err("empty capture".into());
    }
    Ok(bytes)
}

// Captures the visible page as PNG and returns it base64-encoded; the renderer stores it through the
// existing `reference.saveAsset` so the file lives with the other board assets.
#[tauri::command]
pub async fn livesite_capture(app: AppHandle) -> Result<String, String> {
    let wv = app.get_webview(LABEL).ok_or("no live site")?;
    #[cfg(windows)]
    {
        use base64::Engine as _;
        let bytes = capture_png(&wv).await?;
        Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
    }
    #[cfg(not(windows))]
    {
        let _ = wv;
        Err("unsupported platform".into())
    }
}

// Clears the busy flag and closes the snapshot webview on every exit path.
struct SnapGuard(AppHandle);
impl Drop for SnapGuard {
    fn drop(&mut self) {
        if let Some(wv) = self.0.get_webview(SNAP_LABEL) {
            let _ = wv.close();
        }
        if let Ok(mut slot) = SNAP_LOADED.lock() {
            slot.take();
        }
        SNAP_BUSY.store(false, Ordering::SeqCst);
    }
}

// Background picture of a page: loads it in a hidden webview of `w` x `h` logical pixels, waits for
// the load plus a settle delay, captures a PNG and closes the webview. Returns it base64-encoded.
// One at a time, and never while the live card exists (two WebView2 pages at once are too heavy).
#[tauri::command]
pub async fn livesite_snapshot(app: AppHandle, url: String, w: f64, h: f64) -> Result<String, String> {
    let target = parse_http_url(&url)?;
    if app.get_webview(LABEL).is_some() {
        return Err("live site active".into());
    }
    if SNAP_BUSY.swap(true, Ordering::SeqCst) {
        return Err("snapshot busy".into());
    }
    let _guard = SnapGuard(app.clone());
    ensure_engine(&app);

    let (w, h) = (w.clamp(320.0, 2000.0), h.clamp(240.0, 1600.0));
    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    if let Ok(mut slot) = SNAP_LOADED.lock() {
        *slot = Some(tx);
    }
    let window = app.get_window("main").ok_or("main window not found")?;
    let builder = WebviewBuilder::new(SNAP_LABEL, WebviewUrl::External(target))
        .data_directory(profile_dir(&app)?)
        .incognito(true)
        .on_navigation(|u| matches!(u.scheme(), "http" | "https" | "about"))
        .on_page_load(|_, payload| {
            if matches!(payload.event(), PageLoadEvent::Finished) {
                if let Ok(mut slot) = SNAP_LOADED.lock() {
                    if let Some(tx) = slot.take() {
                        let _ = tx.send(());
                    }
                }
            }
        })
        .on_new_window(|_, _| NewWindowResponse::Deny);
    // Entirely outside the client area: clipped by the parent, invisible, still rendered.
    let pos = Position::Logical(LogicalPosition::new(-(w + 400.0), -(h + 400.0)));
    let webview = window
        .add_child(builder, pos, Size::Logical(LogicalSize::new(w, h)))
        .map_err(|e| e.to_string())?;
    install_blocking(&webview, Target::Snap);

    tokio::time::timeout(Duration::from_secs(25), rx)
        .await
        .map_err(|_| "page load timed out".to_string())?
        .map_err(|_| "snapshot cancelled".to_string())?;
    // Late content (hero images, consent walls settling) needs a moment after the load event.
    tokio::time::sleep(Duration::from_millis(800)).await;

    #[cfg(windows)]
    {
        use base64::Engine as _;
        let bytes = capture_png(&webview).await?;
        Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
    }
    #[cfg(not(windows))]
    {
        Err("unsupported platform".into())
    }
}

#[tauri::command]
pub async fn livesite_close(app: AppHandle) -> Result<(), String> {
    match app.get_webview(LABEL) {
        Some(wv) => wv.close().map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

// ── Ad blocker switch + lists ───────────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdblockStatus {
    enabled: bool,
    ready: bool,
    // Requests refused in the board's own webview (embedded frames) since the app started.
    blocked_main: u32,
    // Age of the newest downloaded list in seconds, when there is one.
    lists_age_secs: Option<u64>,
}

fn status(app: &AppHandle) -> AdblockStatus {
    let age = lists_dir(app).and_then(|dir| {
        FILTER_LISTS
            .iter()
            .filter_map(|(name, _)| std::fs::metadata(dir.join(name)).and_then(|m| m.modified()).ok())
            .filter_map(|t| SystemTime::now().duration_since(t).ok())
            .map(|d| d.as_secs())
            .min()
    });
    AdblockStatus {
        enabled: ENABLED.load(Ordering::Relaxed),
        ready: engine_ready(),
        blocked_main: BLOCKED_MAIN.load(Ordering::Relaxed),
        lists_age_secs: age,
    }
}

#[tauri::command]
pub async fn adblock_status(app: AppHandle) -> Result<AdblockStatus, String> {
    Ok(status(&app))
}

// Master switch for every filtered webview. Persisted as a marker file next to the lists.
#[tauri::command]
pub async fn adblock_set_enabled(app: AppHandle, enabled: bool) -> Result<AdblockStatus, String> {
    ENABLED.store(enabled, Ordering::SeqCst);
    if let Some(dir) = lists_dir(&app) {
        let marker = dir.join(DISABLED_MARKER);
        if enabled {
            let _ = std::fs::remove_file(&marker);
        } else {
            let _ = std::fs::create_dir_all(&dir);
            let _ = std::fs::write(&marker, b"");
        }
    }
    if enabled {
        ensure_engine(&app);
    }
    Ok(status(&app))
}

// Forces a fresh download of the lists and swaps the engine once it is rebuilt.
#[tauri::command]
pub async fn adblock_refresh_lists(app: AppHandle) -> Result<AdblockStatus, String> {
    let dir = lists_dir(&app).ok_or("no cache directory")?;
    ENGINE_STARTED.store(true, Ordering::SeqCst);
    rebuild_engine(dir, true).await;
    Ok(status(&app))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowlist_matches_host_and_subdomains() {
        let list = vec!["example.com".to_string()];
        assert!(host_matches(&list, "example.com"));
        assert!(host_matches(&list, "www.example.com"));
        assert!(host_matches(&list, "a.b.example.com"));
        assert!(!host_matches(&list, "notexample.com"));
        assert!(!host_matches(&[String::new()], "example.com"));
    }

    #[test]
    fn app_and_players_are_excluded() {
        for h in ["localhost", "127.0.0.1", "tauri.localhost", "x.convex.cloud", "www.youtube-nocookie.com", "discord.com"] {
            assert!(is_excluded_host(h), "{h}");
        }
        assert!(!is_excluded_host("doubleclick.net"));
    }

    #[test]
    fn same_site_uses_registrable_domain() {
        assert!(same_site("a.example.com", "b.example.com"));
        assert!(same_site("a.bbc.co.uk", "www.bbc.co.uk"));
        assert!(!same_site("example.com", "tracker.net"));
    }

    #[test]
    fn only_http_urls_are_accepted() {
        assert!(parse_http_url("https://example.com/a").is_ok());
        assert!(parse_http_url("javascript:alert(1)").is_err());
        assert!(parse_http_url("file:///c:/x").is_err());
    }
}
