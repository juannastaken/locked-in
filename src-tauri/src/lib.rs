use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager, WindowEvent};
use tauri_plugin_sql::{Migration, MigrationKind};

// ---------- anti-doomscroll (native watcher, immune to webview throttling) ----------
// temporarily disabled — flip to true to bring the blocker back
const DOOMSCROLL_ENABLED: bool = false;

const INSTA_MAX_SNOOZES: u32 = 3;
const INSTA_SNOOZE_SECS: u64 = 20;

#[derive(Default, Clone)]
struct InstaCfg {
  enabled: bool,
  limit_min: u64,
  work_min: u64,
  bonus_min: u64,
  focus_today_sec: u64,
}

#[derive(Default)]
struct InstaState {
  cfg: InstaCfg,
  used_sec: u64,
  date: String,
  snoozes_used: u32,
  snooze_until: Option<Instant>,
  last_persist: u64,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct InstaPersist {
  date: String,
  used_sec: u64,
  snoozes_used: u32,
}

fn insta_file(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
  app
    .path()
    .app_config_dir()
    .ok()
    .map(|d| d.join("insta_state.json"))
}

fn insta_persist(app: &tauri::AppHandle, st: &InstaState) {
  if let Some(path) = insta_file(app) {
    let data = InstaPersist {
      date: st.date.clone(),
      used_sec: st.used_sec,
      snoozes_used: st.snoozes_used,
    };
    if let Ok(json) = serde_json::to_string(&data) {
      let _ = std::fs::write(path, json);
    }
  }
}

/// Doomscroll detector — expects a lowercased window title.
fn is_doomscroll(title: &str) -> bool {
  const PATTERNS: [&str; 6] = ["instagram", "tiktok", "facebook", "reddit", "kwai", "twitter"];
  if PATTERNS.iter().any(|p| title.contains(p)) {
    return true;
  }
  // x.com tabs: "Página inicial / X - Brave" etc.
  if title.ends_with("/ x") || title.contains("/ x -") || title.contains("/ x ·") {
    return true;
  }
  // youtube shorts (best-effort: shorts feed or #shorts-tagged titles)
  if title.contains("youtube") && title.contains("shorts") {
    return true;
  }
  false
}

fn fg_title() -> Option<String> {
  use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW};
  unsafe {
    let hwnd = GetForegroundWindow();
    if hwnd.is_invalid() {
      return None;
    }
    let mut buf = [0u16; 512];
    let len = GetWindowTextW(hwnd, &mut buf);
    if len <= 0 {
      return None;
    }
    Some(String::from_utf16_lossy(&buf[..len as usize]))
  }
}

/// Executable name of the current foreground window (e.g. "Discord.exe").
fn fg_exe() -> Option<String> {
  use windows::Win32::Foundation::CloseHandle;
  use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
    PROCESS_QUERY_LIMITED_INFORMATION,
  };
  use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

  unsafe {
    let hwnd = GetForegroundWindow();
    if hwnd.is_invalid() {
      return None;
    }
    let mut pid: u32 = 0;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));
    if pid == 0 {
      return None;
    }
    let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
    let mut buf = [0u16; 512];
    let mut len = buf.len() as u32;
    let result = QueryFullProcessImageNameW(
      handle,
      PROCESS_NAME_WIN32,
      windows::core::PWSTR(buf.as_mut_ptr()),
      &mut len,
    );
    let _ = CloseHandle(handle);
    result.ok()?;
    let path = String::from_utf16_lossy(&buf[..len as usize]);
    path.rsplit('\\').next().map(|s| s.to_string())
  }
}

/// Seconds since the last keyboard/mouse input, system-wide.
fn idle_seconds() -> u64 {
  use windows::Win32::System::SystemInformation::GetTickCount;
  use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};

  unsafe {
    let mut info = LASTINPUTINFO {
      cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
      dwTime: 0,
    };
    if GetLastInputInfo(&mut info).as_bool() {
      let tick = GetTickCount();
      (tick.wrapping_sub(info.dwTime) / 1000) as u64
    } else {
      0
    }
  }
}

// ---------- popup watchers: hourly check-in + anti-procrastination nudge ----------
// Native threads so WebView2 timer throttling can never silence them.

const NUDGE_COOLDOWN_SECS: u64 = 10 * 60;
const NUDGE_AWAY_RESET_SECS: u64 = 45;

#[derive(Default, Clone, serde::Deserialize)]
#[serde(default)]
struct WatcherCfg {
  checkin_enabled: bool,
  checkin_interval_min: u64,
  checkin_only_session: bool,
  nudge_enabled: bool,
  nudge_threshold_min: u64,
  nudge_apps: String,
  /// auto-start a session when a whitelisted work app gains focus
  autotrack_enabled: bool,
  autotrack_apps: String,
  /// mascot motivational quotes every N minutes
  quotes_enabled: bool,
  quotes_interval_min: u64,
  session_active: bool,
  /// true while on break or paused — nudges stay quiet
  suspended: bool,
  lang: String,
  sound: bool,
  accent: String,
}

#[derive(Default)]
struct WatcherState {
  cfg: WatcherCfg,
  /// (day, slot, interval) of the last seen check-in period
  last_slot: Option<(String, i64, i64)>,
  /// continuous seconds on a distraction app/site
  acc_sec: u64,
  /// continuous seconds away from any distraction (resets acc past a grace)
  away_sec: u64,
  current_app: String,
  nudge_cooldown_until: Option<Instant>,
  /// auto-track: seconds focused on a work app / away from all of them
  work_acc_sec: u64,
  work_away_sec: u64,
  /// edge trigger — set once "entered work app" fires; clears only after 60s
  /// away, so stopping a session while inside the app never restarts it
  work_fired: bool,
  /// edge triggers for auto-pause (left work apps 10s+) / auto-resume (back)
  away_fired: bool,
  back_fired: bool,
  /// seconds until the next mascot quote
  quote_countdown_sec: u64,
}

fn fmt_min(total_min: i64) -> String {
  let m = total_min.rem_euclid(24 * 60);
  format!("{:02}:{:02}", m / 60, m % 60)
}

fn title_case(s: &str) -> String {
  let mut c = s.chars();
  match c.next() {
    Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
    None => String::new(),
  }
}

/// Matches the lowercased window title / exe against the comma-separated
/// distraction list. Multi-word entries require every word in the title.
fn match_distraction(title: &str, exe: &str, list: &str) -> Option<String> {
  for raw in list.split(',') {
    let entry = raw.trim().to_lowercase();
    if entry.is_empty() {
      continue;
    }
    let hit = if entry.contains(' ') {
      entry.split_whitespace().all(|w| title.contains(w))
    } else {
      title.contains(&entry) || exe.contains(&entry)
    };
    if hit {
      return Some(entry);
    }
    // x.com tabs render as "Home / X - Brave" — cover them when twitter/x is watched
    if (entry == "twitter" || entry == "x.com")
      && (title.ends_with("/ x") || title.contains("/ x -") || title.contains("/ x ·"))
    {
      return Some("twitter".into());
    }
  }
  None
}

/// Moves the popup window to the bottom-right corner of the primary work area.
fn position_popup(window: &tauri::WebviewWindow) {
  use windows::Win32::Foundation::RECT;
  use windows::Win32::UI::WindowsAndMessaging::{
    SystemParametersInfoW, SPI_GETWORKAREA, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS,
  };

  let mut rect = RECT::default();
  let ok = unsafe {
    SystemParametersInfoW(
      SPI_GETWORKAREA,
      0,
      Some(&mut rect as *mut _ as *mut _),
      SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
    )
  }
  .is_ok();
  if !ok {
    return;
  }
  let size = match window.outer_size() {
    Ok(s) => s,
    Err(_) => return,
  };
  let margin = (16.0 * window.scale_factor().unwrap_or(1.0)) as i32;
  let x = rect.right - size.width as i32 - margin;
  let y = rect.bottom - size.height as i32 - margin;
  let _ = window.set_position(tauri::PhysicalPosition { x, y });
}

fn fire_popup(handle: &tauri::AppHandle, payload: serde_json::Value) {
  if let Some(w) = handle.get_webview_window("popup") {
    position_popup(&w);
    let _ = handle.emit_to("popup", "popup:show", payload);
    let _ = w.show();
    let _ = w.set_always_on_top(true);
  }
}

fn popup_watcher(handle: tauri::AppHandle) {
  use chrono::Timelike;

  let mut last = Instant::now();
  loop {
    std::thread::sleep(Duration::from_secs(3));
    let delta = last.elapsed().as_secs().clamp(1, 60);
    last = Instant::now();

    let state = handle.state::<Mutex<WatcherState>>();
    let mut st = state.lock().unwrap();
    let cfg = st.cfg.clone();

    // ---- hourly check-in: fire when an interval boundary is crossed ----
    let now = chrono::Local::now();
    let interval = (cfg.checkin_interval_min.clamp(5, 24 * 60)) as i64;
    let mins = (now.hour() * 60 + now.minute()) as i64;
    let slot = mins / interval;
    let day = now.format("%Y-%m-%d").to_string();
    let boundary_close = mins % interval < 2;

    let changed = match &st.last_slot {
      None => {
        st.last_slot = Some((day.clone(), slot, interval));
        false
      }
      Some((d, s, iv)) if *iv != interval => {
        // interval setting changed — resync without firing
        let _ = (d, s);
        st.last_slot = Some((day.clone(), slot, interval));
        false
      }
      Some((d, s, _)) if *d != day || *s != slot => {
        st.last_slot = Some((day.clone(), slot, interval));
        true
      }
      _ => false,
    };

    if changed
      && boundary_close
      && cfg.checkin_enabled
      && (!cfg.checkin_only_session || cfg.session_active)
      && idle_seconds() < 600
    {
      // the period that just ended
      let (p_day, start_min, end_min) = if mins < interval {
        // first slot of the day → yesterday's last period
        let yesterday = (now.date_naive() - chrono::Days::new(1))
          .format("%Y-%m-%d")
          .to_string();
        let total = 24 * 60;
        let start = ((total - 1) / interval) * interval;
        (yesterday, start, total)
      } else {
        let end = slot * interval;
        (day.clone(), end - interval, end)
      };
      fire_popup(
        &handle,
        serde_json::json!({
          "kind": "checkin",
          "day": p_day,
          "periodStart": fmt_min(start_min),
          "periodEnd": fmt_min(end_min),
          "lang": cfg.lang,
          "sound": cfg.sound,
          "accent": cfg.accent,
        }),
      );
      continue;
    }

    // ---- anti-procrastination nudge (own windows never count either way) ----
    let title = fg_title().unwrap_or_default().to_lowercase();
    let exe = fg_exe().unwrap_or_default().to_lowercase();
    let own_window = title.contains("locked in");
    if !own_window {
      match match_distraction(&title, &exe, &cfg.nudge_apps) {
        Some(label) => {
          st.acc_sec += delta;
          st.away_sec = 0;
          st.current_app = label;
        }
        None => {
          st.away_sec += delta;
          if st.away_sec >= NUDGE_AWAY_RESET_SECS {
            st.acc_sec = 0;
          }
        }
      }
    }

    // ---- auto-track: whitelisted work app in focus → auto-start a session;
    // leaving every work app 10s+ / coming back emit pause/resume edges.
    // Being on Locked In itself counts as AWAY from work (unlike the nudge).
    let on_work = if own_window {
      None
    } else {
      match_distraction(&title, &exe, &cfg.autotrack_apps)
    };
    match on_work {
      Some(work_label) => {
        st.work_acc_sec += delta;
        st.work_away_sec = 0;
        st.away_fired = false;
        if cfg.autotrack_enabled && !st.back_fired && st.work_acc_sec >= 3 {
          st.back_fired = true;
          let _ = handle.emit_to("main", "autotrack:back", serde_json::json!({}));
        }
        if cfg.autotrack_enabled
          && !cfg.session_active
          && !cfg.suspended
          && !st.work_fired
          && st.work_acc_sec >= 9
        {
          st.work_fired = true;
          let _ = handle.emit_to(
            "main",
            "autotrack:start",
            serde_json::json!({ "app": work_label }),
          );
        }
      }
      None => {
        st.work_away_sec += delta;
        if cfg.autotrack_enabled && !st.away_fired && st.work_away_sec >= 10 {
          st.away_fired = true;
          st.back_fired = false;
          let _ = handle.emit_to("main", "autotrack:away", serde_json::json!({}));
        }
        if st.work_away_sec >= 60 {
          st.work_acc_sec = 0;
          st.work_fired = false;
        }
      }
    }

    let cooldown_ok = st
      .nudge_cooldown_until
      .map(|t| Instant::now() >= t)
      .unwrap_or(true);
    let popup_busy = handle
      .get_webview_window("popup")
      .and_then(|w| w.is_visible().ok())
      .unwrap_or(false);

    // ---- mascot quotes on a timer (the popup picks the phrase itself) ----
    if cfg.quotes_enabled {
      let interval_secs = cfg.quotes_interval_min.clamp(1, 24 * 60) * 60;
      if st.quote_countdown_sec == 0 || st.quote_countdown_sec > interval_secs {
        st.quote_countdown_sec = interval_secs;
      }
      st.quote_countdown_sec = st.quote_countdown_sec.saturating_sub(delta);
      if st.quote_countdown_sec == 0 {
        if !popup_busy && idle_seconds() < 300 {
          st.quote_countdown_sec = interval_secs;
          fire_popup(
            &handle,
            serde_json::json!({
              "kind": "quote",
              "lang": cfg.lang,
              "sound": false,
              "accent": cfg.accent,
            }),
          );
        } else {
          // user away or popup in use — try again in a minute
          st.quote_countdown_sec = 60;
        }
      }
    } else {
      st.quote_countdown_sec = 0;
    }

    if cfg.nudge_enabled
      && !cfg.suspended
      && cooldown_ok
      && !popup_busy
      && st.acc_sec >= cfg.nudge_threshold_min.max(1) * 60
    {
      st.nudge_cooldown_until = Some(Instant::now() + Duration::from_secs(NUDGE_COOLDOWN_SECS));
      let payload = serde_json::json!({
        "kind": "nudge",
        "app": title_case(&st.current_app),
        "minutes": st.acc_sec / 60,
        "lang": cfg.lang,
        "sound": cfg.sound,
        "accent": cfg.accent,
      });
      fire_popup(&handle, payload);
    }
  }
}

/// Frontend feeds settings + live session phase into the native watchers.
#[tauri::command]
fn sync_watchers(state: tauri::State<'_, Mutex<WatcherState>>, cfg: WatcherCfg) {
  let mut st = state.lock().unwrap();
  st.cfg = cfg;
}

/// Fires the check-in popup immediately (preview from Settings; popup won't persist).
#[tauri::command]
fn test_checkin(app: tauri::AppHandle, state: tauri::State<'_, Mutex<WatcherState>>) {
  use chrono::Timelike;
  let cfg = state.lock().unwrap().cfg.clone();
  let now = chrono::Local::now();
  let interval = (cfg.checkin_interval_min.clamp(5, 24 * 60)) as i64;
  let mins = (now.hour() * 60 + now.minute()) as i64;
  let slot = mins / interval;
  let (day, start_min, end_min) = if slot == 0 {
    let yesterday = (now.date_naive() - chrono::Days::new(1))
      .format("%Y-%m-%d")
      .to_string();
    let total = 24 * 60;
    (yesterday, ((total - 1) / interval) * interval, total)
  } else {
    (
      now.format("%Y-%m-%d").to_string(),
      (slot - 1) * interval,
      slot * interval,
    )
  };
  fire_popup(
    &app,
    serde_json::json!({
      "kind": "checkin",
      "day": day,
      "periodStart": fmt_min(start_min),
      "periodEnd": fmt_min(end_min),
      "lang": cfg.lang,
      "sound": cfg.sound,
      "accent": cfg.accent,
      "test": true,
    }),
  );
}

/// Shows a mascot quote right now (preview from Settings).
#[tauri::command]
fn test_quote(app: tauri::AppHandle, state: tauri::State<'_, Mutex<WatcherState>>) {
  let cfg = state.lock().unwrap().cfg.clone();
  fire_popup(
    &app,
    serde_json::json!({
      "kind": "quote",
      "lang": cfg.lang,
      "sound": false,
      "accent": cfg.accent,
    }),
  );
}

/// Fires the anti-procrastination nudge immediately (preview from Settings).
#[tauri::command]
fn test_nudge(app: tauri::AppHandle, state: tauri::State<'_, Mutex<WatcherState>>) {
  let cfg = state.lock().unwrap().cfg.clone();
  fire_popup(
    &app,
    serde_json::json!({
      "kind": "nudge",
      "app": "Discord",
      "minutes": cfg.nudge_threshold_min.max(1),
      "lang": cfg.lang,
      "sound": cfg.sound,
      "accent": cfg.accent,
    }),
  );
}

/// New version available — shows the custom update popup in the corner.
#[tauri::command]
fn show_update_popup(
  app: tauri::AppHandle,
  state: tauri::State<'_, Mutex<WatcherState>>,
  version: String,
  url: String,
) {
  let cfg = state.lock().unwrap().cfg.clone();
  fire_popup(
    &app,
    serde_json::json!({
      "kind": "update",
      "version": version,
      "url": url,
      "lang": cfg.lang,
      "sound": cfg.sound,
      "accent": cfg.accent,
    }),
  );
}

/// Dedicated jam-call popup: shows who's calling and answers straight from
/// the corner (the main window holds the actual accept logic).
#[tauri::command]
fn show_jam_call(
  app: tauri::AppHandle,
  state: tauri::State<'_, Mutex<WatcherState>>,
  username: String,
  task: String,
  incoming_kind: String,
) {
  let cfg = state.lock().unwrap().cfg.clone();
  fire_popup(
    &app,
    serde_json::json!({
      "kind": "jamcall",
      "username": username,
      "task": task,
      "incomingKind": incoming_kind,
      "lang": cfg.lang,
      "sound": cfg.sound,
      "accent": cfg.accent,
    }),
  );
}

/// Generic in-app notification card (milestones, burnout, auto-end, break end) —
/// replaces the native Windows toast everywhere.
#[tauri::command]
fn show_notice(
  app: tauri::AppHandle,
  state: tauri::State<'_, Mutex<WatcherState>>,
  title: String,
  body: String,
  mood: String,
  data: Option<String>,
  avatar: Option<String>,
) {
  let cfg = state.lock().unwrap().cfg.clone();
  fire_popup(
    &app,
    serde_json::json!({
      "kind": "notice",
      "title": title,
      "body": body,
      "mood": mood,
      "data": data,
      "avatar": avatar,
      "lang": cfg.lang,
      "sound": false,
      "accent": cfg.accent,
    }),
  );
}

/// "I'm back" / snooze from the nudge popup: reset the counter with a grace period.
#[tauri::command]
fn nudge_ack(state: tauri::State<'_, Mutex<WatcherState>>, grace_min: u64) {
  let mut st = state.lock().unwrap();
  st.acc_sec = 0;
  st.away_sec = 0;
  st.nudge_cooldown_until =
    Some(Instant::now() + Duration::from_secs(grace_min.clamp(1, 60) * 60));
}

fn insta_watcher(handle: tauri::AppHandle) {
  let mut last = Instant::now();
  // 3s normally; 1s hunter-mode once the limit is blown, so reopening
  // instagram gets blocked near-instantly
  let mut tick = Duration::from_secs(3);
  loop {
    std::thread::sleep(tick);
    let delta = last.elapsed().as_secs().clamp(1, 120);
    last = Instant::now();

    let title = fg_title().unwrap_or_default().to_lowercase();
    let own = title.contains("locked in");
    let on_insta = is_doomscroll(&title);

    let state = handle.state::<Mutex<InstaState>>();
    let mut st = state.lock().unwrap();
    if !st.cfg.enabled {
      continue;
    }

    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    if st.date != today {
      st.date = today;
      st.used_sec = 0;
      st.snoozes_used = 0;
      st.snooze_until = None;
      st.last_persist = 0;
    }

    if own {
      continue; // our own windows never count as insta nor as "left insta"
    }

    if on_insta {
      st.used_sec += delta;
    }

    let work_sec = st.cfg.work_min.max(1) * 60;
    let allowance =
      st.cfg.limit_min * 60 + (st.cfg.focus_today_sec / work_sec) * st.cfg.bonus_min * 60;
    let over = st.used_sec >= allowance;
    let snoozed = st.snooze_until.map(|t| t > Instant::now()).unwrap_or(false);

    if st.used_sec >= st.last_persist + 15 {
      st.last_persist = st.used_sec;
      insta_persist(&handle, &st);
    }

    let used = st.used_sec;
    let snoozes_left = INSTA_MAX_SNOOZES.saturating_sub(st.snoozes_used);
    let focus_to_next = work_sec - (st.cfg.focus_today_sec % work_sec);
    let bonus = st.cfg.bonus_min;
    drop(st);

    tick = if over {
      Duration::from_secs(1)
    } else {
      Duration::from_secs(3)
    };

    if let Some(blocker) = handle.get_webview_window("blocker") {
      if on_insta && over && !snoozed {
        let _ = handle.emit_to(
          "blocker",
          "blocker:state",
          serde_json::json!({
            "usedSec": used,
            "allowanceSec": allowance,
            "focusToNextSec": focus_to_next,
            "bonusMin": bonus,
            "snoozesLeft": snoozes_left,
          }),
        );
        // unconditional every tick: Windows sometimes reports the window as
        // visible while it never actually came to the front — force it
        let _ = blocker.show();
        let _ = blocker.set_always_on_top(true);
        let _ = blocker.set_focus();
      } else if !on_insta && blocker.is_visible().unwrap_or(false) {
        let _ = blocker.hide();
      }
    }
  }
}

/// Finds the visible window whose title mentions Instagram and sends it Ctrl+W
/// (closes just that browser tab — user-initiated, nothing destructive).
#[tauri::command]
fn close_insta_tab() -> bool {
  use windows::core::BOOL;
  use windows::Win32::Foundation::{HWND, LPARAM};
  use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VIRTUAL_KEY,
    VK_CONTROL,
  };
  use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowTextW, IsWindowVisible, SetForegroundWindow,
  };

  unsafe extern "system" fn find_insta(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let out = lparam.0 as *mut HWND;
    if IsWindowVisible(hwnd).as_bool() {
      let mut buf = [0u16; 512];
      let len = GetWindowTextW(hwnd, &mut buf);
      if len > 0 {
        let title = String::from_utf16_lossy(&buf[..len as usize]).to_lowercase();
        if is_doomscroll(&title) {
          unsafe { *out = hwnd };
          return BOOL(0); // stop enumeration
        }
      }
    }
    BOOL(1)
  }

  unsafe {
    let mut found = HWND::default();
    let _ = EnumWindows(Some(find_insta), LPARAM(&mut found as *mut HWND as isize));
    if found.is_invalid() {
      return false;
    }
    let _ = SetForegroundWindow(found);
    std::thread::sleep(Duration::from_millis(150));

    let key = |vk: VIRTUAL_KEY, up: bool| INPUT {
      r#type: INPUT_KEYBOARD,
      Anonymous: INPUT_0 {
        ki: KEYBDINPUT {
          wVk: vk,
          wScan: 0,
          dwFlags: if up { KEYEVENTF_KEYUP } else { Default::default() },
          time: 0,
          dwExtraInfo: 0,
        },
      },
    };
    let inputs = [
      key(VK_CONTROL, false),
      key(VIRTUAL_KEY(0x57), false), // W
      key(VIRTUAL_KEY(0x57), true),
      key(VK_CONTROL, true),
    ];
    SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
    true
  }
}

/// Called by the frontend to feed settings + today's focus time; returns used seconds.
#[tauri::command]
fn sync_insta(
  state: tauri::State<'_, Mutex<InstaState>>,
  enabled: bool,
  limit_min: u64,
  work_min: u64,
  bonus_min: u64,
  focus_today_sec: u64,
) -> u64 {
  let mut st = state.lock().unwrap();
  st.cfg = InstaCfg {
    enabled,
    limit_min,
    work_min,
    bonus_min,
    focus_today_sec,
  };
  st.used_sec
}

/// One of the limited daily snoozes: hides the blocker for a few seconds.
#[tauri::command]
fn insta_snooze(app: tauri::AppHandle, state: tauri::State<'_, Mutex<InstaState>>) -> u32 {
  let mut st = state.lock().unwrap();
  let left = INSTA_MAX_SNOOZES.saturating_sub(st.snoozes_used);
  if left == 0 {
    return 0;
  }
  st.snoozes_used += 1;
  st.snooze_until = Some(Instant::now() + Duration::from_secs(INSTA_SNOOZE_SECS));
  let remaining = INSTA_MAX_SNOOZES.saturating_sub(st.snoozes_used);
  insta_persist(&app, &st);
  drop(st);
  if let Some(b) = app.get_webview_window("blocker") {
    let _ = b.hide();
  }
  remaining
}

// ---------- discord rich presence ----------
// One background thread owns the IPC connection. Discord may be closed or
// restart at any time, so every cycle (new message or 15s retry tick) it
// lazily (re)connects and re-applies the latest presence.

const DISCORD_APP_ID: &str = "1529876072533856368"; // Discord Developer Portal application id

#[derive(Clone)]
struct PresenceData {
  details: String,
  state: String,
  start_epoch: Option<i64>,
  clear: bool,
}

static PRESENCE_TX: std::sync::OnceLock<std::sync::mpsc::Sender<PresenceData>> =
  std::sync::OnceLock::new();

fn start_presence_thread() {
  let (tx, rx) = std::sync::mpsc::channel::<PresenceData>();
  let _ = PRESENCE_TX.set(tx);
  std::thread::spawn(move || {
    use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
    let mut client: Option<DiscordIpcClient> = None;
    let mut current: Option<PresenceData> = None;
    let mut dirty = false;
    loop {
      match rx.recv_timeout(std::time::Duration::from_secs(15)) {
        Ok(msg) => {
          current = Some(msg);
          dirty = true;
        }
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
          // retry tick: only re-apply if we lost the connection
          dirty = dirty || client.is_none();
        }
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
      }
      let Some(p) = current.clone() else { continue };
      if !dirty {
        continue;
      }
      if client.is_none() {
        if let Ok(mut c) = DiscordIpcClient::new(DISCORD_APP_ID) {
          if c.connect().is_ok() {
            client = Some(c);
          }
        }
      }
      if let Some(c) = client.as_mut() {
        let ok = if p.clear {
          c.clear_activity().is_ok()
        } else {
          let mut act = activity::Activity::new().assets(
            activity::Assets::new()
              .large_image("logo")
              .large_text("Locked In"),
          );
          if !p.details.is_empty() {
            act = act.details(&p.details);
          }
          if !p.state.is_empty() {
            act = act.state(&p.state);
          }
          if let Some(ts) = p.start_epoch {
            act = act.timestamps(activity::Timestamps::new().start(ts));
          }
          c.set_activity(act).is_ok()
        };
        if ok {
          dirty = false;
        } else {
          // pipe died (discord closed) — drop and reconnect on the next cycle
          client = None;
        }
      }
    }
  });
}

#[tauri::command]
fn discord_presence(details: String, state: String, start_epoch: Option<i64>, clear: bool) {
  if let Some(tx) = PRESENCE_TX.get() {
    let _ = tx.send(PresenceData { details, state, start_epoch, clear });
  }
}

fn migrations() -> Vec<Migration> {
  vec![
    Migration {
      version: 1,
      description: "create_core_tables",
      sql: include_str!("../migrations/001_init.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 2,
      description: "create_milestones",
      sql: include_str!("../migrations/002_milestones.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 3,
      description: "settings_v2_defaults",
      sql: include_str!("../migrations/003_settings_v2.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 4,
      description: "mirror_afk_habits",
      sql: include_str!("../migrations/004_mirror_habits.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 5,
      description: "chat_autoend_settings",
      sql: include_str!("../migrations/005_v4.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 6,
      description: "default_api_key",
      sql: include_str!("../migrations/006_default_key.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 7,
      description: "anti_instagram",
      sql: include_str!("../migrations/007_anti_insta.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 8,
      description: "chat_state",
      sql: include_str!("../migrations/008_chat_state.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 9,
      description: "language_and_conversations",
      sql: include_str!("../migrations/009_lang_convos.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 10,
      description: "pause_and_hourly_log",
      sql: include_str!("../migrations/010_v5.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 11,
      description: "refboard",
      sql: include_str!("../migrations/011_refboard.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 12,
      description: "project_goals",
      sql: include_str!("../migrations/012_goals.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 13,
      description: "jam_members",
      sql: include_str!("../migrations/013_jam.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 14,
      description: "tasks",
      sql: include_str!("../migrations/014_tasks.sql"),
      kind: MigrationKind::Up,
    },
  ]
}

// ---------- reference board (PureRef-style) ----------

fn ref_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
  let dir = app
    .path()
    .app_config_dir()
    .map_err(|e| e.to_string())?
    .join("refboard");
  std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  Ok(dir)
}

/// Copies a dropped image into the app's refboard folder; returns the stored path.
#[tauri::command]
fn import_ref_image(app: tauri::AppHandle, src: String) -> Result<String, String> {
  let source = std::path::PathBuf::from(&src);
  let ext = source
    .extension()
    .and_then(|e| e.to_str())
    .unwrap_or("")
    .to_lowercase();
  const OK: [&str; 7] = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif"];
  if !OK.contains(&ext.as_str()) {
    return Err(format!("unsupported image type: {ext}"));
  }
  let dir = ref_dir(&app)?;
  let name = format!(
    "{}-{}.{}",
    chrono::Local::now().format("%Y%m%d%H%M%S"),
    std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .map(|d| d.subsec_nanos())
      .unwrap_or(0),
    ext
  );
  let target = dir.join(&name);
  std::fs::copy(&source, &target).map_err(|e| e.to_string())?;
  Ok(target.display().to_string())
}

/// Saves a pasted (clipboard) image into the refboard folder; returns the path.
#[tauri::command]
fn import_ref_image_b64(app: tauri::AppHandle, data: String, ext: String) -> Result<String, String> {
  use base64::Engine;
  let ext = ext.to_lowercase();
  const OK: [&str; 4] = ["png", "jpg", "jpeg", "webp"];
  if !OK.contains(&ext.as_str()) {
    return Err(format!("unsupported image type: {ext}"));
  }
  let bytes = base64::engine::general_purpose::STANDARD
    .decode(data)
    .map_err(|e| e.to_string())?;
  let dir = ref_dir(&app)?;
  let name = format!(
    "{}-{}.{}",
    chrono::Local::now().format("%Y%m%d%H%M%S"),
    std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .map(|d| d.subsec_nanos())
      .unwrap_or(0),
    ext
  );
  let target = dir.join(&name);
  std::fs::write(&target, bytes).map_err(|e| e.to_string())?;
  Ok(target.display().to_string())
}

/// Encrypts a secret (the user's API key) with Windows DPAPI, tied to the
/// current Windows user account. The ciphertext is worthless on another
/// machine or under another account — so even a copied database file can't
/// leak the key. Returns base64 of the protected blob.
#[tauri::command]
fn dpapi_encrypt(plain: String) -> Result<String, String> {
  use base64::Engine;
  use windows::Win32::Foundation::{LocalFree, HLOCAL};
  use windows::Win32::Security::Cryptography::{CryptProtectData, CRYPT_INTEGER_BLOB};

  let mut bytes = plain.into_bytes();
  let input = CRYPT_INTEGER_BLOB {
    cbData: bytes.len() as u32,
    pbData: bytes.as_mut_ptr(),
  };
  let mut output = CRYPT_INTEGER_BLOB::default();
  unsafe {
    CryptProtectData(
      &input,
      windows::core::PCWSTR::null(),
      None,
      None,
      None,
      0,
      &mut output,
    )
    .map_err(|e| e.to_string())?;
    let slice = std::slice::from_raw_parts(output.pbData, output.cbData as usize);
    let b64 = base64::engine::general_purpose::STANDARD.encode(slice);
    let _ = LocalFree(Some(HLOCAL(output.pbData as *mut _)));
    Ok(b64)
  }
}

/// Reverses `dpapi_encrypt` — only succeeds for the same Windows user.
#[tauri::command]
fn dpapi_decrypt(blob: String) -> Result<String, String> {
  use base64::Engine;
  use windows::Win32::Foundation::{LocalFree, HLOCAL};
  use windows::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB};

  let mut bytes = base64::engine::general_purpose::STANDARD
    .decode(blob)
    .map_err(|e| e.to_string())?;
  let input = CRYPT_INTEGER_BLOB {
    cbData: bytes.len() as u32,
    pbData: bytes.as_mut_ptr(),
  };
  let mut output = CRYPT_INTEGER_BLOB::default();
  unsafe {
    CryptUnprotectData(
      &input,
      None,
      None,
      None,
      None,
      0,
      &mut output,
    )
    .map_err(|e| e.to_string())?;
    let slice = std::slice::from_raw_parts(output.pbData, output.cbData as usize);
    let text = String::from_utf8_lossy(slice).into_owned();
    let _ = LocalFree(Some(HLOCAL(output.pbData as *mut _)));
    Ok(text)
  }
}

/// Persists the Canvas Mode (Excalidraw) scene as JSON in the app config dir.
#[tauri::command]
fn save_canvas(app: tauri::AppHandle, data: String) -> Result<(), String> {
  let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
  std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  std::fs::write(dir.join("canvas.json"), data).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_canvas(app: tauri::AppHandle) -> Result<String, String> {
  let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
  match std::fs::read_to_string(dir.join("canvas.json")) {
    Ok(s) => Ok(s),
    Err(_) => Ok(String::new()),
  }
}

/// Deletes a stored refboard image file (only inside the refboard folder).
#[tauri::command]
fn delete_ref_image(app: tauri::AppHandle, path: String) -> Result<(), String> {
  let dir = ref_dir(&app)?;
  // canonicalize BOTH sides before the containment check: PathBuf::starts_with
  // is a lexical component match that never resolves `..`, so a path like
  // `<refboard>/../../secret` slipped past it. canonicalize() collapses `..`
  // and symlinks against the real filesystem, so the check can't be fooled.
  let dir = dir.canonicalize().map_err(|e| e.to_string())?;
  let target = std::path::PathBuf::from(&path)
    .canonicalize()
    .map_err(|e| e.to_string())?;
  if !target.starts_with(&dir) {
    return Err("path outside refboard folder".into());
  }
  std::fs::remove_file(&target).map_err(|e| e.to_string())?;
  Ok(())
}

#[tauri::command]
fn set_tray_status(app: tauri::AppHandle, tooltip: String) {
  if let Some(tray) = app.tray_by_id("main-tray") {
    let _ = tray.set_tooltip(Some(tooltip.as_str()));
  }
}

/// Start-with-Windows via the HKCU Run key — written directly so the exe path
/// is always the current one and properly quoted (the autostart plugin choked
/// on paths with spaces). `--minimized` makes boot launches start in the tray.
#[tauri::command]
fn set_autostart(enabled: bool) -> Result<(), String> {
  use winreg::enums::{HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE};
  use winreg::RegKey;
  let hkcu = RegKey::predef(HKEY_CURRENT_USER);
  let run = hkcu
    .open_subkey_with_flags(
      r"Software\Microsoft\Windows\CurrentVersion\Run",
      KEY_SET_VALUE | KEY_QUERY_VALUE,
    )
    .map_err(|e| e.to_string())?;
  if enabled {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let value = format!("\"{}\" --minimized", exe.display());
    run
      .set_value("Locked In", &value)
      .map_err(|e| e.to_string())?;
  } else {
    // deleting a value that isn't there is fine
    let _ = run.delete_value("Locked In");
  }
  Ok(())
}

/// Rebuilds the tray menu in the chosen language.
#[tauri::command]
fn set_tray_lang(app: tauri::AppHandle, lang: String) -> Result<(), String> {
  let (open_label, quit_label) = if lang == "en" {
    ("Open", "Quit")
  } else {
    ("Abrir", "Sair")
  };
  let show_item =
    MenuItem::with_id(&app, "show", open_label, true, None::<&str>).map_err(|e| e.to_string())?;
  let quit_item =
    MenuItem::with_id(&app, "quit", quit_label, true, None::<&str>).map_err(|e| e.to_string())?;
  let menu = Menu::with_items(&app, &[&show_item, &quit_item]).map_err(|e| e.to_string())?;
  if let Some(tray) = app.tray_by_id("main-tray") {
    tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
  }
  Ok(())
}

/// Shows the main window and re-applies the app icon — Windows sometimes
/// reverts the taskbar icon after a hide/show cycle from the tray.
fn show_main(app: &tauri::AppHandle) {
  if let Some(window) = app.get_webview_window("main") {
    if let Some(icon) = app.default_window_icon() {
      let _ = window.set_icon(icon.clone());
    }
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
  }
}

#[tauri::command]
fn show_main_window(app: tauri::AppHandle) {
  show_main(&app);
}


/// Executable name of the current foreground window (e.g. "RobloxStudioBeta.exe").
#[tauri::command]
fn get_foreground_app() -> Option<String> {
  fg_exe()
}

/// Copies the sqlite db (plus WAL/SHM) to backups/locked-in-YYYY-MM-DD.db,
/// once per day, keeping the 14 most recent backups.
#[tauri::command]
fn backup_database(app: tauri::AppHandle) -> Result<String, String> {
  use std::fs;

  let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
  let db = dir.join("locked-in.db");
  if !db.exists() {
    return Ok("no-db".into());
  }
  let backups = dir.join("backups");
  fs::create_dir_all(&backups).map_err(|e| e.to_string())?;

  let today = chrono::Local::now().format("%Y-%m-%d").to_string();
  let target = backups.join(format!("locked-in-{today}.db"));
  if target.exists() {
    return Ok("already-done".into());
  }

  fs::copy(&db, &target).map_err(|e| e.to_string())?;
  for ext in ["-wal", "-shm"] {
    let side = dir.join(format!("locked-in.db{ext}"));
    if side.exists() {
      let _ = fs::copy(&side, backups.join(format!("locked-in-{today}.db{ext}")));
    }
  }

  // prune: keep the 14 newest daily backups (plus their sidecars)
  let mut days: Vec<String> = fs::read_dir(&backups)
    .map_err(|e| e.to_string())?
    .flatten()
    .filter_map(|e| {
      let name = e.file_name().to_string_lossy().to_string();
      if name.starts_with("locked-in-") && name.ends_with(".db") {
        Some(name)
      } else {
        None
      }
    })
    .collect();
  days.sort();
  while days.len() > 14 {
    let old = days.remove(0);
    let _ = fs::remove_file(backups.join(&old));
    for ext in ["-wal", "-shm"] {
      let _ = fs::remove_file(backups.join(format!("{old}{ext}")));
    }
  }

  Ok(target.display().to_string())
}

/// Title of the current foreground window (e.g. the active browser tab title).
#[tauri::command]
fn get_foreground_window_title() -> Option<String> {
  fg_title()
}

/// Seconds since the last keyboard/mouse input, system-wide.
#[tauri::command]
fn get_idle_seconds() -> u64 {
  idle_seconds()
}

/// Old installers shipped migration 006 with content that was later rewritten
/// as a no-op — sqlx then refuses the db ("previously applied but has been
/// modified") for anyone upgrading from those builds. Rewrites the recorded
/// checksum to match the current file and scrubs the legacy seeded API key.
/// Best-effort: every failure is ignored (fresh installs have nothing to heal).
fn heal_legacy_db(app: &tauri::AppHandle) {
  use sha2::{Digest, Sha384};
  let Ok(dir) = app.path().app_config_dir() else {
    return;
  };
  let db_path = dir.join("locked-in.db");
  if !db_path.exists() {
    return;
  }
  let Ok(conn) = rusqlite::Connection::open(&db_path) else {
    return;
  };
  let checksum: Vec<u8> =
    Sha384::digest(include_str!("../migrations/006_default_key.sql").as_bytes()).to_vec();
  let _ = conn.execute(
    "UPDATE _sqlx_migrations SET checksum = ?1 WHERE version = 6",
    rusqlite::params![checksum],
  );
  let _ = conn.execute(
    "UPDATE settings SET value = '' WHERE key = 'anthropic_api_key' AND value LIKE 'sk-ant-api03-QF4r%'",
    [],
  );
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // managed BEFORE any window exists — the frontend syncs config the moment it
    // boots, and setup() runs too late for that first invoke
    .manage(Mutex::new(WatcherState::default()))
    // second launch just brings the existing (possibly tray-hidden) window forward
    .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
      show_main(app);
    }))
    .plugin(
      tauri_plugin_sql::Builder::default()
        .add_migrations("sqlite:locked-in.db", migrations())
        .build(),
    )
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .invoke_handler(tauri::generate_handler![
      set_tray_status,
      set_tray_lang,
      get_foreground_app,
      get_idle_seconds,
      get_foreground_window_title,
      backup_database,
      sync_insta,
      insta_snooze,
      close_insta_tab,
      show_main_window,
      set_autostart,
      sync_watchers,
      nudge_ack,
      test_checkin,
      test_nudge,
      test_quote,
      show_notice,
      show_jam_call,
      show_update_popup,
      import_ref_image,
      import_ref_image_b64,
      delete_ref_image,
      save_canvas,
      load_canvas,
      dpapi_encrypt,
      dpapi_decrypt,
      discord_presence
    ])
    .setup(|app| {
      // fix dbs coming from legacy installers BEFORE the frontend loads the db
      heal_legacy_db(&app.handle());

      // discord rich presence pipe (lazy — connects when discord is running)
      start_presence_thread();

      // anti-instagram: restore today's usage, then start the native watcher
      let mut initial = InstaState::default();
      initial.date = chrono::Local::now().format("%Y-%m-%d").to_string();
      if let Some(path) = insta_file(&app.handle()) {
        if let Ok(raw) = std::fs::read_to_string(path) {
          if let Ok(saved) = serde_json::from_str::<InstaPersist>(&raw) {
            if saved.date == initial.date {
              initial.used_sec = saved.used_sec;
              initial.snoozes_used = saved.snoozes_used;
            }
          }
        }
      }
      app.manage(Mutex::new(initial));
      if DOOMSCROLL_ENABLED {
        let watcher_handle = app.handle().clone();
        std::thread::spawn(move || insta_watcher(watcher_handle));
      }

      // hourly check-in + anti-procrastination nudge (native thread;
      // its state is managed on the Builder, before any window boots)
      let popup_handle = app.handle().clone();
      std::thread::spawn(move || popup_watcher(popup_handle));

      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      let show_item = MenuItem::with_id(app, "show", "Open", true, None::<&str>)?;
      let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
      let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

      let _tray = TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
          "quit" => app.exit(0),
          "show" => show_main(app),
          _ => {}
        })
        .on_tray_icon_event(|tray, event| {
          if let tauri::tray::TrayIconEvent::Click {
            button: tauri::tray::MouseButton::Left,
            button_state: tauri::tray::MouseButtonState::Up,
            ..
          } = event
          {
            show_main(tray.app_handle());
          }
        })
        .build(app)?;

      let window = app.get_webview_window("main").unwrap();

      // launched by Windows startup (--minimized): live in the tray only
      if std::env::args().any(|a| a == "--minimized") {
        let _ = window.hide();
      }

      let window_clone = window.clone();
      window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
          api.prevent_close();
          let _ = window_clone.hide();
        }
      });

      // auto-allow microphone for voice notes: answer the WebView2 permission
      // request natively so the raw "tauri.localhost wants to..." prompt never
      // shows (and a previously clicked "Block" can't wedge the feature)
      #[cfg(windows)]
      {
        use webview2_com::{PermissionRequestedEventHandler, SetPermissionStateCompletedHandler};
        use webview2_com::Microsoft::Web::WebView2::Win32::{
          ICoreWebView2Profile4, ICoreWebView2_13, COREWEBVIEW2_PERMISSION_KIND,
          COREWEBVIEW2_PERMISSION_KIND_MICROPHONE, COREWEBVIEW2_PERMISSION_STATE_ALLOW,
        };
        use windows::core::{Interface, HSTRING, PCWSTR};
        let _ = window.with_webview(|webview| unsafe {
          let core = match webview.controller().CoreWebView2() {
            Ok(c) => c,
            Err(_) => return,
          };
          // a previously clicked "Block" is persisted in the profile and silently
          // auto-denies without ever raising PermissionRequested — overwrite the
          // saved state with ALLOW for every origin the app can run under
          if let Ok(wv13) = core.cast::<ICoreWebView2_13>() {
            if let Ok(profile) = wv13.Profile() {
              if let Ok(p4) = profile.cast::<ICoreWebView2Profile4>() {
                for origin in [
                  "http://tauri.localhost",
                  "https://tauri.localhost",
                  "http://localhost:1420",
                ] {
                  let origin = HSTRING::from(origin);
                  let done = SetPermissionStateCompletedHandler::create(Box::new(|_| Ok(())));
                  let _ = p4.SetPermissionState(
                    COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
                    PCWSTR(origin.as_ptr()),
                    COREWEBVIEW2_PERMISSION_STATE_ALLOW,
                    &done,
                  );
                }
              }
            }
          }
          let mut token: i64 = 0;
          let handler = PermissionRequestedEventHandler::create(Box::new(|_, args| {
            if let Some(args) = args {
              let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
              if args.PermissionKind(&mut kind).is_ok()
                && kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE
              {
                let _ = args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW);
              }
            }
            Ok(())
          }));
          let _ = core.add_PermissionRequested(&handler, &mut token);
        });
      }

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
 
