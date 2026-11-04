import { DEMO_LINES, DEMO_SPEAKERS, isSpeakerLabel, quoteCoverage } from "@proass/shared";
import type { TranscriptSegment } from "@proass/shared";

export interface SpeakerInfo {
  /** Label from the transcript: a diarization label ("A") or a scripted name ("Lan"). */
  label: string;
  name: string;
  role?: string;
  /** True when `name` is a real name (typed by the user, from the demo script, or already a name). */
  named: boolean;
  initials: string;
  /** Palette slot, assigned in order of first appearance so colours never collide. */
  color: number;
  talkMs: number;
  lines: number;
}

export type SpeakerMap = Map<string, SpeakerInfo>;

const ROLE_BY_NAME = new Map(DEMO_SPEAKERS.map((s) => [s.name, s.role]));

/**
 * Names diarized speakers in the live demo: each transcript line votes for the scripted speaker whose
 * lines it matches, so "B" becomes "Quang" however Muse orders its labels (or merges two short turns).
 */
function demoNames(segments: TranscriptSegment[]): Map<string, string> {
  const votes = new Map<string, Map<string, number>>();
  for (const seg of segments) {
    if (!seg.speaker || !isSpeakerLabel(seg.speaker)) continue;
    for (const line of DEMO_LINES) {
      if (quoteCoverage(line.text, seg.text) < 0.6) continue;
      const tally = votes.get(seg.speaker) ?? new Map<string, number>();
      tally.set(line.speaker, (tally.get(line.speaker) ?? 0) + line.text.length);
      votes.set(seg.speaker, tally);
    }
  }
  const names = new Map<string, string>();
  for (const [label, tally] of votes) names.set(label, [...tally].sort((a, b) => b[1] - a[1])[0]![0]);
  return names;
}

function initialsOf(name: string): string {
  const words = name.replace(/^Speaker\s+/, "").split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0]![0]! + words.at(-1)![0]! : (words[0] ?? "?")[0]!).toUpperCase();
}

/** Everyone who spoke, in order of first appearance, with display names: typed name > demo script > label. */
export function resolveSpeakers(segments: TranscriptSegment[], typed: Record<string, string>, isDemo: boolean): SpeakerMap {
  const fromDemo = isDemo ? demoNames(segments) : new Map<string, string>();
  const map: SpeakerMap = new Map();
  for (const seg of segments) {
    const label = seg.speaker;
    if (!label) continue;
    let info = map.get(label);
    if (!info) {
      const name = typed[label] || fromDemo.get(label) || (isSpeakerLabel(label) ? `Speaker ${label}` : label);
      const named = name !== `Speaker ${label}`;
      // Roles belong to the demo cast only, not to someone in a real meeting who happens to be called Lan.
      const role = isDemo ? ROLE_BY_NAME.get(name) : undefined;
      info = { label, name, role, named, initials: initialsOf(named ? name : label), color: map.size, talkMs: 0, lines: 0 };
      map.set(label, info);
    }
    info.talkMs += Math.max(0, seg.endMs - seg.startMs);
    info.lines++;
  }
  return map;
}

/** Display name for a label, falling back to "Speaker A" for labels not in the map. */
export function displayName(label: string, speakers: SpeakerMap): string {
  return speakers.get(label)?.name ?? (isSpeakerLabel(label) ? `Speaker ${label}` : label);
}

/** Label → name for every speaker with a real name; sent to the server so insights use names. */
export function namesForServer(speakers: SpeakerMap): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of speakers.values()) if (s.named && s.name !== s.label) out[s.label] = s.name;
  return out;
}
