export type TimedWord = {
  text: string;
  start: number;
  end: number;
  speaker?: string;
};

function tidy(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?;:’'])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .trim();
}

export function wordsToTranscript(words: TimedWord[]): string {
  if (words.length === 0) return "";
  const counts = new Map<string, number>();
  for (const word of words) {
    if (!word.speaker) continue;
    counts.set(word.speaker, (counts.get(word.speaker) ?? 0) + 1);
  }
  const speakers = [...counts.entries()].filter(([, seen]) => seen > words.length * 0.08);
  const labelSpeakers = speakers.length >= 2;
  const names = new Map<string, string>();
  speakers.forEach(([speaker], index) => {
    names.set(speaker, `Speaker ${index + 1}`);
  });

  const paragraphs: string[] = [];
  let current: string[] = [];
  let currentSpeaker = words[0]?.speaker;
  let previousEnd = words[0]?.start ?? 0;

  const flush = () => {
    if (current.length === 0) return;
    const text = tidy(current.join(" "));
    if (!text) {
      current = [];
      return;
    }
    if (labelSpeakers && currentSpeaker && names.has(currentSpeaker)) {
      paragraphs.push(`${names.get(currentSpeaker)}: ${text}`);
    } else {
      paragraphs.push(text);
    }
    current = [];
  };

  for (const word of words) {
    const token = word.text.trim();
    if (!token) continue;
    const gap = word.start - previousEnd;
    const speakerChanged = labelSpeakers && word.speaker && word.speaker !== currentSpeaker && current.length > 12;
    if ((gap > 1.15 && current.length > 8) || speakerChanged) flush();
    if (word.speaker) currentSpeaker = word.speaker;
    current.push(token);
    previousEnd = word.end || word.start;
  }
  flush();
  return paragraphs.join("\n\n");
}

export function planChunks(
  start: number,
  end: number,
  features: Array<{ rms: number }>,
): Array<{ start: number; end: number }> {
  const target = 300;
  const chunks: Array<{ start: number; end: number }> = [];
  let cursor = start;
  while (cursor < end - 0.4) {
    let boundary = Math.min(end, cursor + target);
    if (end - boundary > 20) {
      const around = Math.round(boundary);
      let best = around;
      let bestRms = Number.POSITIVE_INFINITY;
      for (let second = around - 12; second <= around + 12; second += 1) {
        const feature = features[second];
        if (!feature) continue;
        if (feature.rms < bestRms) {
          bestRms = feature.rms;
          best = second;
        }
      }
      if (best > cursor + 45) boundary = Math.min(end, best);
    }
    if (boundary <= cursor) boundary = Math.min(end, cursor + target);
    chunks.push({ start: cursor, end: boundary });
    cursor = boundary;
  }
  return chunks;
}

export function clipForSuggestion(transcript: string): string {
  const text = transcript.trim();
  if (text.length <= 12000) return text;
  return `${text.slice(0, 9000)}\n\n[…]\n\n${text.slice(-2500)}`;
}

export function sermonKeyterms(speaker: string, scripture: string): string[] {
  const terms = ["Citizens Church", "Citizens", "Wentzville", "Jesus", "Christ", "Gospel"];
  const name = speaker.trim();
  if (name) {
    terms.push(name);
    for (const part of name.split(/\s+/)) {
      if (part.length > 2) terms.push(part);
    }
  }
  const passage = scripture.trim();
  if (passage) terms.push(passage.slice(0, 50));
  return [...new Set(terms)].slice(0, 40);
}
