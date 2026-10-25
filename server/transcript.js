// Turn timed words (or plain text) into readable paragraphs, split on pauses
// or every ~4-6 sentences.

/** @typedef {{ text:string, start:number, end:number, speaker?:string }} TimedWord */

function tidy(text) {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?;:’'])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .trim();
}

/** @param {TimedWord[]} words */
export function wordsToTranscript(words) {
  if (words.length === 0) return "";
  const counts = new Map();
  for (const word of words) {
    if (!word.speaker) continue;
    counts.set(word.speaker, (counts.get(word.speaker) ?? 0) + 1);
  }
  const speakers = [...counts.entries()].filter(([, seen]) => seen > words.length * 0.08);
  const labelSpeakers = speakers.length >= 2;
  const names = new Map();
  speakers.forEach(([speaker], index) => {
    names.set(speaker, `Speaker ${index + 1}`);
  });

  const paragraphs = [];
  let current = [];
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
    const speakerChanged =
      labelSpeakers && word.speaker && word.speaker !== currentSpeaker && current.length > 12;
    if ((gap > 1.15 && current.length > 8) || speakerChanged) flush();
    if (word.speaker) currentSpeaker = word.speaker;
    current.push(token);
    previousEnd = word.end || word.start;
  }
  flush();
  return paragraphs.join("\n\n");
}

/** Fallback paragrapher for engines that only return plain text (no word timings). */
export function textToParagraphs(text) {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return "";
  if (/\n\s*\n/.test(clean)) {
    return clean
      .split(/\n\s*\n+/)
      .map((p) => tidy(p))
      .filter(Boolean)
      .join("\n\n");
  }
  // One long block: split into sentences and group ~4 per paragraph.
  const sentences = clean.match(/[^.!?]+[.!?]+(?:["'’”)]+)?|\S+$/g) ?? [clean];
  const paragraphs = [];
  let bucket = [];
  for (const sentence of sentences) {
    bucket.push(sentence.trim());
    if (bucket.length >= 4) {
      paragraphs.push(tidy(bucket.join(" ")));
      bucket = [];
    }
  }
  if (bucket.length) paragraphs.push(tidy(bucket.join(" ")));
  return paragraphs.join("\n\n");
}

export function clipForSuggestion(transcript) {
  const text = transcript.trim();
  if (text.length <= 12000) return text;
  return `${text.slice(0, 9000)}\n\n[…]\n\n${text.slice(-2500)}`;
}

export function sermonKeyterms(speaker, scripture) {
  const terms = ["Citizens Church", "Citizens", "Wentzville", "Jesus", "Christ", "Gospel"];
  const name = (speaker ?? "").trim();
  if (name) {
    terms.push(name);
    for (const part of name.split(/\s+/)) {
      if (part.length > 2) terms.push(part);
    }
  }
  const passage = (scripture ?? "").trim();
  if (passage) terms.push(passage.slice(0, 50));
  return [...new Set(terms)].slice(0, 40);
}
