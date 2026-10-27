// SPDX-License-Identifier: GPL-3.0-or-later
//! Crash-recovery snapshots in the app data directory, one set of files per session.
//!
//! A session's snapshot is `autosave-<session>.json`. Writes go to a temporary
//! file that is flushed to disk and then renamed over the snapshot, so a crash or
//! full disk never leaves a half-written snapshot. Before a snapshot is replaced
//! it is copied to a numbered backup, at most once per BACKUP_INTERVAL, keeping
//! the newest BACKUP_COUNT copies. Each session has its own files, so a new
//! session never overwrites the snapshot of one that has not been recovered yet.

use std::collections::BTreeSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use tauri::{AppHandle, Manager};

const PREFIX: &str = "autosave-";
const BACKUP_COUNT: u32 = 5;
const BACKUP_INTERVAL: Duration = Duration::from_secs(10 * 60);

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
  let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
  fs::create_dir_all(&dir).map_err(|e| format!("无法创建应用数据目录 {}：{e}", dir.display()))?;
  Ok(dir)
}

/// Session ids become file names, so only a plain token is accepted.
fn check_session(session: &str) -> Result<(), String> {
  let ok = !session.is_empty() && session.len() <= 64 && session.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
  if ok { Ok(()) } else { Err(format!("无效的会话标识：{session}")) }
}

fn snapshot_path(dir: &Path, session: &str) -> PathBuf {
  dir.join(format!("{PREFIX}{session}.json"))
}

fn backup_path(dir: &Path, session: &str, n: u32) -> PathBuf {
  dir.join(format!("{PREFIX}{session}.{n}.json"))
}

fn rotate_backups(dir: &Path, session: &str, current: &Path) -> std::io::Result<()> {
  let newest = backup_path(dir, session, 1);
  let due = match fs::metadata(&newest).and_then(|m| m.modified()) {
    Ok(t) => SystemTime::now().duration_since(t).unwrap_or_default() >= BACKUP_INTERVAL,
    Err(_) => true,
  };
  if !due {
    return Ok(());
  }
  for n in (1..BACKUP_COUNT).rev() {
    let from = backup_path(dir, session, n);
    if from.exists() {
      fs::rename(&from, backup_path(dir, session, n + 1))?;
    }
  }
  fs::copy(current, newest)?;
  Ok(())
}

fn write_atomic(dir: &Path, session: &str, contents: &str) -> std::io::Result<()> {
  let target = snapshot_path(dir, session);
  let tmp = dir.join(format!("{PREFIX}{session}.json.tmp"));
  {
    let mut file = fs::File::create(&tmp)?;
    file.write_all(contents.as_bytes())?;
    file.sync_all()?;
  }
  if target.exists() {
    // A failed backup must not block saving the newer snapshot.
    if let Err(e) = rotate_backups(dir, session, &target) {
      log::warn!("autosave backup rotation failed: {e}");
    }
  }
  fs::rename(&tmp, &target)?;
  // Persist the rename itself; a no-op where directories cannot be opened (Windows).
  if let Ok(d) = fs::File::open(dir) {
    let _ = d.sync_all();
  }
  Ok(())
}

/// Sessions with a snapshot or a backup, from file names `autosave-<session>[.<n>].json`.
fn list_sessions(dir: &Path) -> std::io::Result<Vec<String>> {
  let mut sessions = BTreeSet::new();
  for entry in fs::read_dir(dir)? {
    let name = entry?.file_name().to_string_lossy().into_owned();
    let Some(rest) = name.strip_prefix(PREFIX).and_then(|r| r.strip_suffix(".json")) else { continue };
    let session = match rest.rsplit_once('.') {
      Some((s, n)) if n.parse::<u32>().is_ok() => s,
      _ => rest,
    };
    if check_session(session).is_ok() {
      sessions.insert(session.to_string());
    }
  }
  Ok(sessions.into_iter().collect())
}

fn clear_session(dir: &Path, session: &str) -> std::io::Result<()> {
  let paths = std::iter::once(snapshot_path(dir, session)).chain((1..=BACKUP_COUNT).map(|n| backup_path(dir, session, n)));
  for path in paths {
    match fs::remove_file(path) {
      Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e),
      _ => {}
    }
  }
  Ok(())
}

#[tauri::command]
pub fn autosave_write(app: AppHandle, session: String, contents: String) -> Result<(), String> {
  check_session(&session)?;
  let dir = data_dir(&app)?;
  write_atomic(&dir, &session, &contents).map_err(|e| format!("自动保存写入失败：{e}"))
}

#[tauri::command]
pub fn autosave_sessions(app: AppHandle) -> Result<Vec<String>, String> {
  let dir = data_dir(&app)?;
  list_sessions(&dir).map_err(|e| format!("无法读取应用数据目录：{e}"))
}

/// Slot 0 is the session's snapshot, 1..=BACKUP_COUNT its backups from newest to oldest.
#[tauri::command]
pub fn autosave_read(app: AppHandle, session: String, slot: u32) -> Result<Option<String>, String> {
  check_session(&session)?;
  if slot > BACKUP_COUNT {
    return Ok(None);
  }
  let dir = data_dir(&app)?;
  let path = if slot == 0 { snapshot_path(&dir, &session) } else { backup_path(&dir, &session, slot) };
  match fs::read_to_string(&path) {
    Ok(text) => Ok(Some(text)),
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
    Err(e) => Err(format!("无法读取 {}：{e}", path.display())),
  }
}

/// Removes a session's snapshot and backups: after it ended cleanly, or was recovered or discarded.
#[tauri::command]
pub fn autosave_clear(app: AppHandle, session: String) -> Result<(), String> {
  check_session(&session)?;
  let dir = data_dir(&app)?;
  clear_session(&dir, &session).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
  use super::*;

  fn temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("gatc-autosave-{tag}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
  }

  #[test]
  fn atomic_write_replaces_and_backs_up() {
    let dir = temp_dir("write");
    write_atomic(&dir, "s1", "one").unwrap();
    write_atomic(&dir, "s1", "two").unwrap();
    assert_eq!(fs::read_to_string(snapshot_path(&dir, "s1")).unwrap(), "two");
    assert_eq!(fs::read_to_string(backup_path(&dir, "s1", 1)).unwrap(), "one");
    assert!(!dir.join("autosave-s1.json.tmp").exists());
    // Within BACKUP_INTERVAL the backup is not rotated again.
    write_atomic(&dir, "s1", "three").unwrap();
    assert_eq!(fs::read_to_string(backup_path(&dir, "s1", 1)).unwrap(), "one");
    fs::remove_dir_all(&dir).unwrap();
  }

  #[test]
  fn sessions_are_kept_apart() {
    let dir = temp_dir("sessions");
    write_atomic(&dir, "old-session", "crashed work").unwrap();
    write_atomic(&dir, "new-session", "a").unwrap();
    write_atomic(&dir, "new-session", "b").unwrap();
    assert_eq!(fs::read_to_string(snapshot_path(&dir, "old-session")).unwrap(), "crashed work");
    assert_eq!(list_sessions(&dir).unwrap(), vec!["new-session".to_string(), "old-session".to_string()]);
    clear_session(&dir, "new-session").unwrap();
    assert_eq!(list_sessions(&dir).unwrap(), vec!["old-session".to_string()]);
    fs::remove_dir_all(&dir).unwrap();
  }

  #[test]
  fn rejects_session_ids_that_are_not_plain_tokens() {
    assert!(check_session("../escape").is_err());
    assert!(check_session("").is_err());
    assert!(check_session("a/b").is_err());
    assert!(check_session("0e8f1c2a-7b3d-4c5e-9f60-1a2b3c4d5e6f").is_ok());
  }
}
