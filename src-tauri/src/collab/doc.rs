//! The collaborative document (`docs/collab.md` §3).
//!
//! One authoritative Loro document per project, owned here. Renderers hold read-only replicas and
//! never write into containers: they send typed operations, Rust validates and applies them.
//!
//! Why not a generic `set(path)` API: it would let a buggy — or compromised — renderer build states
//! the board cannot represent, and it would step straight past the atomicity rules below. Geometry,
//! crop, trim and every other group is ONE value, so two people dragging the same item produce one
//! winner rather than Alice's position married to Bob's size.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use loro::{ExportMode, LoroDoc, LoroMap, LoroMovableList, LoroValue, VersionVector};
use serde::Serialize;

use super::identity;
use super::ids::ProjectId;
pub use super::ops::CollabOp as Op;
use super::ops::{CollabOp, OperationBatch, OP_PROTOCOL_VERSION};

/// Layout of the document itself. A build that does not understand it opens the project read-only
/// rather than rewriting it into something the writer cannot read back.
const DOC_SCHEMA_VERSION: i64 = 1;
const ROOT_META: &str = "meta";
const ROOT_ITEMS: &str = "items";
const ROOT_ORDER: &str = "order";
const ROOT_STROKES: &str = "strokes";
const ROOT_STROKE_ORDER: &str = "strokeOrder";
const ROOT_SHAPES: &str = "shapes";
const ROOT_SHAPE_ORDER: &str = "shapeOrder";

const KEY_SCHEMA: &str = "schemaVersion";
const KEY_DELETED: &str = "deleted";
const KEY_TEXT: &str = "text";

#[derive(Debug)]
pub enum DocError {
    Io(String),
    Loro(String),
    /// The document was written by a newer build. Opened read-only, never rewritten.
    Schema(i64),
    /// The renderer speaks another operation protocol.
    Protocol(u32),
    /// The operation cannot apply to this document: unknown item, tombstoned item, bad payload.
    Rejected(String),
}

impl std::fmt::Display for DocError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(what) => write!(f, "collaborative document: {what}"),
            Self::Loro(what) => write!(f, "collaborative document: {what}"),
            Self::Schema(found) => write!(
                f,
                "this project was written by a newer build (document format {found}, this build reads {DOC_SCHEMA_VERSION})"
            ),
            Self::Protocol(found) => write!(
                f,
                "operation protocol {found} is not the one this build speaks ({OP_PROTOCOL_VERSION})"
            ),
            Self::Rejected(what) => write!(f, "operation refused: {what}"),
        }
    }
}

impl From<loro::LoroError> for DocError {
    fn from(err: loro::LoroError) -> Self {
        Self::Loro(err.to_string())
    }
}

#[derive(Serialize)]
pub struct ApplyResult {
    pub revision: u64,
    pub applied: usize,
}

struct Project {
    doc: LoroDoc,
    undo: loro::UndoManager,
    revision: u64,
    path: PathBuf,
    /// A newer schema is readable but frozen: writing would produce a document its own author
    /// could no longer open.
    read_only: bool,
}

static PROJECTS: Mutex<Option<HashMap<String, Project>>> = Mutex::new(None);

fn projects_dir() -> PathBuf {
    super::identity::collab_dir().join("projects")
}

fn project_path(project_id: &str) -> Result<PathBuf, DocError> {
    let project_id =
        ProjectId::parse(project_id).map_err(|error| DocError::Rejected(error.to_string()))?;
    Ok(projects_dir().join(format!("{}.loro", project_id.storage_key())))
}

/// Peer id derived from the device identity, so every operation is attributable to this machine and
/// stays attributable across restarts. A random peer id per session would fragment the history.
fn peer_id() -> u64 {
    match identity::get_or_init() {
        Ok(identity) => {
            let seed = identity.public().device_id.as_bytes();
            let mut bytes = [0u8; 8];
            for (slot, byte) in bytes.iter_mut().zip(seed.iter()) {
                *slot = *byte;
            }
            u64::from_le_bytes(bytes)
        }
        Err(_) => 1,
    }
}

fn with_project<T>(
    project_id: &str,
    write: bool,
    body: impl FnOnce(&mut Project) -> Result<T, DocError>,
) -> Result<T, DocError> {
    let mut guard = PROJECTS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let map = guard.get_or_insert_with(HashMap::new);
    if !map.contains_key(project_id) {
        map.insert(project_id.to_string(), open(project_id)?);
    }
    let project = map.get_mut(project_id).expect("just inserted");
    if write && project.read_only {
        return Err(DocError::Schema(read_schema(&project.doc)));
    }
    body(project)
}

fn read_schema(doc: &LoroDoc) -> i64 {
    match doc
        .get_map(ROOT_META)
        .get(KEY_SCHEMA)
        .and_then(|v| v.into_value().ok())
    {
        Some(LoroValue::I64(found)) => found,
        _ => DOC_SCHEMA_VERSION,
    }
}

/// Loads a project from disk, or creates it. A snapshot that fails to import is an error, never a
/// fresh empty document: silently starting over would erase work that is still on this disk.
fn open(project_id: &str) -> Result<Project, DocError> {
    let path = project_path(project_id)?;
    let doc = LoroDoc::new();
    doc.set_peer_id(peer_id())?;
    let mut read_only = false;

    match fs::read(&path) {
        Ok(bytes) => {
            doc.import(&bytes)?;
            let found = read_schema(&doc);
            if found > DOC_SCHEMA_VERSION {
                read_only = true;
            }
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            doc.get_map(ROOT_META)
                .insert(KEY_SCHEMA, DOC_SCHEMA_VERSION)?;
            doc.commit();
        }
        Err(err) => return Err(DocError::Io(err.to_string())),
    }

    let undo = loro::UndoManager::new(&doc);
    Ok(Project {
        doc,
        undo,
        revision: 0,
        path,
        read_only,
    })
}

/// Atomic replace: a crash mid-write leaves the previous snapshot intact rather than a truncated
/// file that would fail to import on the next start.
fn save(project: &Project) -> Result<(), DocError> {
    let bytes = project
        .doc
        .export(ExportMode::Snapshot)
        .map_err(|err| DocError::Loro(err.to_string()))?;
    if let Some(parent) = project.path.parent() {
        fs::create_dir_all(parent).map_err(|err| DocError::Io(err.to_string()))?;
    }
    let temp = project.path.with_extension("loro.part");
    fs::write(&temp, &bytes).map_err(|err| DocError::Io(err.to_string()))?;
    fs::rename(&temp, &project.path).map_err(|err| DocError::Io(err.to_string()))?;
    Ok(())
}

fn items(doc: &LoroDoc) -> LoroMap {
    doc.get_map(ROOT_ITEMS)
}

fn order(doc: &LoroDoc) -> LoroMovableList {
    doc.get_movable_list(ROOT_ORDER)
}

/// The item map, refusing a tombstoned or unknown id.
///
/// Ids are never reused, so a late operation that arrives after a deletion cannot resurrect an item:
/// it is refused here instead of writing into a container the projection already filters out.
fn live_item(doc: &LoroDoc, id: &str) -> Result<LoroMap, DocError> {
    let item = items(doc)
        .get(id)
        .and_then(|value| value.into_container().ok())
        .and_then(|container| container.into_map().ok())
        .ok_or_else(|| DocError::Rejected(format!("unknown item {id}")))?;
    if matches!(
        item.get(KEY_DELETED).and_then(|v| v.into_value().ok()),
        Some(LoroValue::Bool(true))
    ) {
        return Err(DocError::Rejected(format!("item {id} is deleted")));
    }
    Ok(item)
}

fn json<T: Serialize>(value: &T) -> Result<String, DocError> {
    serde_json::to_string(value).map_err(|error| DocError::Rejected(error.to_string()))
}

fn set_atomic<T: Serialize>(doc: &LoroDoc, id: &str, key: &str, value: &T) -> Result<(), DocError> {
    live_item(doc, id)?.insert(key, json(value)?)?;
    Ok(())
}

fn index_in_order(list: &LoroMovableList, id: &str) -> Option<usize> {
    for index in 0..list.len() {
        if let Some(LoroValue::String(found)) = list.get(index).and_then(|v| v.into_value().ok()) {
            if found.as_str() == id {
                return Some(index);
            }
        }
    }
    None
}

fn apply_one(doc: &LoroDoc, op: &CollabOp) -> Result<(), DocError> {
    match op {
        CollabOp::AddItem {
            item_id,
            kind,
            geometry,
        } => {
            let id = item_id.as_str();
            if items(doc).get(id).is_some() {
                return Err(DocError::Rejected(format!("item {id} already exists")));
            }
            let item = items(doc).ensure_mergeable_map(id)?;
            item.insert("kind", json(kind)?.trim_matches('"'))?;
            item.insert("geometry", json(geometry)?)?;
            item.insert(KEY_DELETED, false)?;
            let list = order(doc);
            list.insert(list.len(), id)?;
        }
        // Delete wins over move: the tombstone stays and the id leaves the order. A concurrent move
        // may put the id back, which is why the projection filters tombstones as well.
        CollabOp::DeleteItem { item_id } => {
            let id = item_id.as_str();
            let item = live_item(doc, id)?;
            item.insert(KEY_DELETED, true)?;
            if let Some(index) = index_in_order(&order(doc), id) {
                order(doc).delete(index, 1)?;
            }
        }
        CollabOp::SetGeometry { item_id, geometry } => {
            set_atomic(doc, item_id.as_str(), "geometry", geometry)?
        }
        CollabOp::SetCrop { item_id, crop } => set_atomic(doc, item_id.as_str(), "crop", crop)?,
        CollabOp::SetTrim { item_id, trim } => set_atomic(doc, item_id.as_str(), "trim", trim)?,
        CollabOp::SetAppearance {
            item_id,
            appearance,
        } => set_atomic(doc, item_id.as_str(), "appearance", appearance)?,
        CollabOp::SetTextStyle { item_id, style } => {
            set_atomic(doc, item_id.as_str(), "textStyle", style)?
        }
        CollabOp::SetFrameStyle { item_id, frame } => {
            set_atomic(doc, item_id.as_str(), "frameStyle", frame)?
        }
        CollabOp::SetPlayback { item_id, playback } => {
            set_atomic(doc, item_id.as_str(), "playback", playback)?
        }
        CollabOp::SetMediaManifest { item_id, manifest } => {
            set_atomic(doc, item_id.as_str(), "media", manifest)?
        }
        CollabOp::SetLink { item_id, link } => set_atomic(doc, item_id.as_str(), "link", link)?,
        CollabOp::SetEmbed { item_id, embed } => set_atomic(doc, item_id.as_str(), "embed", embed)?,
        CollabOp::SetSequence { item_id, sequence } => {
            set_atomic(doc, item_id.as_str(), "sequence", sequence)?
        }
        CollabOp::SetPalette { item_id, palette } => {
            set_atomic(doc, item_id.as_str(), "palette", palette)?
        }
        // Text is the ONE field that must not be a whole-value write: two people typing in the same
        // note have to merge character by character, which is what LoroText is for.
        CollabOp::TextInsert {
            item_id,
            index,
            text,
        } => {
            let id = item_id.as_str();
            let item = live_item(doc, id)?;
            let content = item.ensure_mergeable_text(KEY_TEXT)?;
            let index = *index as usize;
            if index > content.len_unicode() {
                return Err(DocError::Rejected("text index out of range".into()));
            }
            content.insert(index, text)?;
        }
        CollabOp::TextDelete {
            item_id,
            index,
            len,
        } => {
            let id = item_id.as_str();
            let item = live_item(doc, id)?;
            let content = item.ensure_mergeable_text(KEY_TEXT)?;
            let index = *index as usize;
            let len = *len as usize;
            if index.saturating_add(len) > content.len_unicode() {
                return Err(DocError::Rejected("text range out of bounds".into()));
            }
            content.delete(index, len)?;
        }
        CollabOp::MoveItem { item_id, before } => {
            let id = item_id.as_str();
            live_item(doc, id)?;
            let list = order(doc);
            let from = index_in_order(&list, id)
                .ok_or_else(|| DocError::Rejected(format!("item {id} is not in the order")))?;
            let target = if let Some(before) = before {
                let before_id = before.as_str();
                live_item(doc, before_id)?;
                let before_index = index_in_order(&list, before_id).ok_or_else(|| {
                    DocError::Rejected(format!("item {before_id} is not in the order"))
                })?;
                if from < before_index {
                    before_index.saturating_sub(1)
                } else {
                    before_index
                }
            } else {
                list.len().saturating_sub(1)
            };
            list.mov(from, target)?;
        }
        // A finished stroke is one immutable value, not a list of points: one operation instead of
        // thousands. Erasing part of a stroke deletes it and adds the remaining segments as new ones.
        CollabOp::AddStroke(stroke_value) => {
            let id = stroke_value.stroke_id.as_str();
            let strokes = doc.get_map(ROOT_STROKES);
            if strokes.get(id).is_some() {
                return Err(DocError::Rejected(format!("stroke {id} already exists")));
            }
            let stroke = strokes.ensure_mergeable_map(id)?;
            stroke.insert("data", json(stroke_value)?)?;
            stroke.insert(KEY_DELETED, false)?;
            let list = doc.get_movable_list(ROOT_STROKE_ORDER);
            list.insert(list.len(), id)?;
        }
        CollabOp::DeleteStroke { stroke_id } => {
            let id = stroke_id.as_str();
            let strokes = doc.get_map(ROOT_STROKES);
            let stroke = strokes
                .get(id)
                .and_then(|value| value.into_container().ok())
                .and_then(|container| container.into_map().ok())
                .ok_or_else(|| DocError::Rejected(format!("unknown stroke {id}")))?;
            stroke.insert(KEY_DELETED, true)?;
            let list = doc.get_movable_list(ROOT_STROKE_ORDER);
            if let Some(index) = index_in_order(&list, id) {
                list.delete(index, 1)?;
            }
        }
        CollabOp::UpsertShape(shape_value) => {
            let id = shape_value.shape_id.as_str();
            let shapes = doc.get_map(ROOT_SHAPES);
            let existed = shapes.get(id).is_some();
            let shape = shapes.ensure_mergeable_map(id)?;
            if matches!(
                shape
                    .get(KEY_DELETED)
                    .and_then(|value| value.into_value().ok()),
                Some(LoroValue::Bool(true))
            ) {
                return Err(DocError::Rejected(format!("shape {id} is deleted")));
            }
            shape.insert("data", json(shape_value)?)?;
            shape.insert(KEY_DELETED, false)?;
            if !existed {
                let list = doc.get_movable_list(ROOT_SHAPE_ORDER);
                list.insert(list.len(), id)?;
            }
        }
        CollabOp::DeleteShape { shape_id } => {
            let id = shape_id.as_str();
            let shapes = doc.get_map(ROOT_SHAPES);
            let shape = shapes
                .get(id)
                .and_then(|value| value.into_container().ok())
                .and_then(|container| container.into_map().ok())
                .ok_or_else(|| DocError::Rejected(format!("unknown shape {id}")))?;
            shape.insert(KEY_DELETED, true)?;
            let list = doc.get_movable_list(ROOT_SHAPE_ORDER);
            if let Some(index) = index_in_order(&list, id) {
                list.delete(index, 1)?;
            }
        }
    }
    Ok(())
}

fn apply_batch_to_doc(doc: &LoroDoc, ops: &[Op]) -> Result<Vec<u8>, DocError> {
    OperationBatch::v1(ops.to_vec())
        .validate()
        .map_err(|error| DocError::Rejected(error.to_string()))?;
    let before = doc.oplog_vv();
    let snapshot = doc
        .export(ExportMode::Snapshot)
        .map_err(|error| DocError::Loro(error.to_string()))?;
    let candidate = LoroDoc::new();
    candidate.import(&snapshot)?;
    candidate.set_peer_id(doc.peer_id())?;
    for operation in ops {
        apply_one(&candidate, operation)?;
    }
    candidate.commit();
    let update = candidate
        .export(ExportMode::updates(&before))
        .map_err(|error| DocError::Loro(error.to_string()))?;
    doc.import(&update)?;
    Ok(update)
}

/// Applies a batch as ONE commit, so a gesture is one entry in the history and one undo step.
///
/// A batch is all-or-nothing at validation time: a refused operation aborts before anything is
/// written, because half a gesture is a state the board cannot draw.
pub fn apply(project_id: &str, protocol: u32, ops: &[Op]) -> Result<ApplyResult, DocError> {
    if protocol != OP_PROTOCOL_VERSION {
        return Err(DocError::Protocol(protocol));
    }
    with_project(project_id, true, |project| {
        apply_batch_to_doc(&project.doc, ops)?;
        project.revision += 1;
        save(project)?;
        Ok(ApplyResult {
            revision: project.revision,
            applied: ops.len(),
        })
    })
}

/// Full snapshot, for a renderer replica that is starting from nothing.
pub fn bootstrap(project_id: &str) -> Result<Vec<u8>, DocError> {
    with_project(project_id, false, |project| {
        project
            .doc
            .export(ExportMode::Snapshot)
            .map_err(|err| DocError::Loro(err.to_string()))
    })
}

/// Everything the caller is missing, given the version vector its replica already holds.
pub fn pull(project_id: &str, since: &[u8]) -> Result<Vec<u8>, DocError> {
    let vv = if since.is_empty() {
        VersionVector::default()
    } else {
        VersionVector::decode(since).map_err(|err| DocError::Loro(err.to_string()))?
    };
    with_project(project_id, false, |project| {
        project
            .doc
            .export(ExportMode::updates(&vv))
            .map_err(|err| DocError::Loro(err.to_string()))
    })
}

/// Imports a remote update — from a peer, a head or a checkpoint — into the authoritative document.
pub fn merge(project_id: &str, update: &[u8]) -> Result<ApplyResult, DocError> {
    with_project(project_id, true, |project| {
        project.doc.import(update)?;
        project.revision += 1;
        save(project)?;
        Ok(ApplyResult {
            revision: project.revision,
            applied: 1,
        })
    })
}

/// Undo is LOCAL: Loro's `UndoManager` only reverts this device's own operations, so nobody can
/// undo someone else's work. It creates a new operation; it never rewrites history.
pub fn undo(project_id: &str) -> Result<ApplyResult, DocError> {
    with_project(project_id, true, |project| {
        project
            .undo
            .undo()
            .map_err(|err| DocError::Loro(err.to_string()))?;
        project.doc.commit();
        project.revision += 1;
        save(project)?;
        Ok(ApplyResult {
            revision: project.revision,
            applied: 1,
        })
    })
}

pub fn redo(project_id: &str) -> Result<ApplyResult, DocError> {
    with_project(project_id, true, |project| {
        project
            .undo
            .redo()
            .map_err(|err| DocError::Loro(err.to_string()))?;
        project.doc.commit();
        project.revision += 1;
        save(project)?;
        Ok(ApplyResult {
            revision: project.revision,
            applied: 1,
        })
    })
}

/// The document's own version vector, encoded — what a replica sends back on the next `pull`.
pub fn version(project_id: &str) -> Result<Vec<u8>, DocError> {
    with_project(project_id, false, |project| {
        Ok(project.doc.oplog_vv().encode())
    })
}

#[cfg(test)]
mod path_tests {
    use super::{apply_batch_to_doc, items, live_item, project_path, Op, KEY_TEXT};
    use crate::collab::ops::{Geometry, ItemKind};
    use loro::{LoroDoc, LoroValue};

    fn geometry(x: f64) -> Geometry {
        Geometry {
            x,
            y: 0.0,
            width: 100.0,
            height: 100.0,
            rotation: 0.0,
            natural_width: None,
            natural_height: None,
            detached: false,
        }
    }

    #[test]
    fn document_path_hashes_and_validates_project_id() {
        let path = project_path("visible-project-name").expect("valid path");
        let file = path
            .file_name()
            .and_then(|name| name.to_str())
            .expect("UTF-8 file name");
        assert!(!file.contains("visible-project-name"));
        assert!(project_path("../escape").is_err());
    }

    #[test]
    fn invalid_second_operation_rolls_back_the_first_operation() {
        let doc = LoroDoc::new();
        let operations = vec![
            Op::AddItem {
                item_id: "one".into(),
                kind: ItemKind::Text,
                geometry: geometry(0.0),
            },
            Op::SetGeometry {
                item_id: "missing".into(),
                geometry: geometry(1.0),
            },
        ];

        assert!(apply_batch_to_doc(&doc, &operations).is_err());
        assert!(items(&doc).get("one").is_none());
    }

    #[test]
    fn text_indices_are_unicode_scalar_indices() {
        let doc = LoroDoc::new();
        let operations = vec![
            Op::AddItem {
                item_id: "note".into(),
                kind: ItemKind::Text,
                geometry: geometry(0.0),
            },
            Op::TextInsert {
                item_id: "note".into(),
                index: 0,
                text: "a👩🏽‍🎨z".into(),
            },
            Op::TextInsert {
                item_id: "note".into(),
                index: 1,
                text: "é".into(),
            },
        ];

        apply_batch_to_doc(&doc, &operations).expect("apply Unicode text");
        let text = live_item(&doc, "note")
            .expect("note")
            .get(KEY_TEXT)
            .and_then(|value| value.into_container().ok())
            .and_then(|container| container.into_text().ok())
            .expect("text");
        assert_eq!(text.to_string(), "aé👩🏽‍🎨z");
        assert!(matches!(
            items(&doc)
                .get("note")
                .and_then(|value| value.into_container().ok())
                .and_then(|container| container.into_map().ok())
                .and_then(|map| map.get("kind"))
                .and_then(|value| value.into_value().ok()),
            Some(LoroValue::String(kind)) if kind.as_str() == "text"
        ));
    }
}
