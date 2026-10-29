// Classement des fichiers par extension (image/video/audio/document/
// archive/texte/autre) → icône + libellé + teinte. Sert au bloc « Fichier » pour l'affichage.
import type { ComponentType } from "react";
import { FileKindArchiveGlyph, FileKindAudioGlyph, FileKindCodeGlyph, FileKindImageGlyph, FileKindOtherGlyph, FileKindSheetGlyph, FileKindSlideGlyph, FileTextGlyph, VideoGlyph } from "../../netsuIcons";
import i18n from "@/i18n";

export type FileKind = "pdf" | "doc" | "sheet" | "slide" | "archive" | "audio" | "video" | "image" | "text" | "code" | "other";

const EXT: Record<string, FileKind> = {
  pdf: "pdf",
  doc: "doc", docx: "doc", odt: "doc", rtf: "doc", pages: "doc",
  xls: "sheet", xlsx: "sheet", ods: "sheet", csv: "sheet", numbers: "sheet",
  ppt: "slide", pptx: "slide", odp: "slide", key: "slide",
  zip: "archive", rar: "archive", "7z": "archive", tar: "archive", gz: "archive",
  mp3: "audio", wav: "audio", flac: "audio", aac: "audio", ogg: "audio", m4a: "audio",
  mp4: "video", mov: "video", mkv: "video", webm: "video", avi: "video",
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", svg: "image", bmp: "image",
  txt: "text", md: "text", log: "text",
  js: "code", ts: "code", tsx: "code", jsx: "code", json: "code", py: "code", rs: "code", html: "code", css: "code",
};

const META: Record<FileKind, { label: string; icon: ComponentType<{ className?: string }>; color: string }> = {
  pdf: { label: "PDF", icon: FileTextGlyph, color: "#e0533d" },
  doc: { get label() { return i18n.t("note:fileKind.doc"); }, icon: FileTextGlyph, color: "#2b7de9" },
  sheet: { get label() { return i18n.t("note:fileKind.sheet"); }, icon: FileKindSheetGlyph, color: "#2ba24c" },
  slide: { get label() { return i18n.t("note:fileKind.slide"); }, icon: FileKindSlideGlyph, color: "#e08a2b" },
  archive: { get label() { return i18n.t("note:fileKind.archive"); }, icon: FileKindArchiveGlyph, color: "#a86bd6" },
  audio: { get label() { return i18n.t("note:audioLabel"); }, icon: FileKindAudioGlyph, color: "#d64f8f" },
  video: { get label() { return i18n.t("note:fileKind.video"); }, icon: VideoGlyph, color: "#6b74e0" },
  image: { get label() { return i18n.t("note:fileKind.image"); }, icon: FileKindImageGlyph, color: "#3dc0c0" },
  text: { get label() { return i18n.t("note:fileKind.text"); }, icon: FileTextGlyph, color: "#7d8899" },
  code: { label: "Code", icon: FileKindCodeGlyph, color: "#5a9e6f" },
  other: { get label() { return i18n.t("note:fileKind.other"); }, icon: FileKindOtherGlyph, color: "#7d8899" },
};

export function extOf(nameOrUrl: string): string {
  const clean = nameOrUrl.split(/[?#]/)[0];
  const base = clean.split(/[\\/]/).pop() || "";
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export function fileKind(nameOrUrl: string): FileKind {
  return EXT[extOf(nameOrUrl)] || "other";
}

export function kindMeta(kind: FileKind) {
  return META[kind];
}
