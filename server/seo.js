// Deterministic SEO heuristics used as the fallback when no xAI key is set (or
// the model call fails). Pure and unit-tested. Scripture parsing covers all 66
// books plus spoken forms ("Jonah chapter one verses seven through sixteen").

/** @typedef {import("./types.js").SeoFields} SeoFields */

export function slugify(input) {
  const base = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (base.length <= 60) return base || "sermon";
  // Trim to <=60 chars on a word boundary.
  const cut = base.slice(0, 60);
  const lastDash = cut.lastIndexOf("-");
  return (lastDash > 20 ? cut.slice(0, lastDash) : cut).replace(/-+$/g, "") || "sermon";
}

const BOOKS = [
  "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua", "Judges", "Ruth",
  "1 Samuel", "2 Samuel", "1 Kings", "2 Kings", "1 Chronicles", "2 Chronicles", "Ezra",
  "Nehemiah", "Esther", "Job", "Psalm", "Psalms", "Proverbs", "Ecclesiastes",
  "Song of Solomon", "Song of Songs", "Isaiah", "Jeremiah", "Lamentations", "Ezekiel",
  "Daniel", "Hosea", "Joel", "Amos", "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk",
  "Zephaniah", "Haggai", "Zechariah", "Malachi", "Matthew", "Mark", "Luke", "John",
  "Acts", "Romans", "1 Corinthians", "2 Corinthians", "Galatians", "Ephesians",
  "Philippians", "Colossians", "1 Thessalonians", "2 Thessalonians", "1 Timothy",
  "2 Timothy", "Titus", "Philemon", "Hebrews", "James", "1 Peter", "2 Peter",
  "1 John", "2 John", "3 John", "Jude", "Revelation",
];

const WORD_NUMBERS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

function wordToNumber(phrase) {
  const parts = phrase.toLowerCase().split(/[\s-]+/).filter(Boolean);
  let total = 0;
  let any = false;
  for (const part of parts) {
    if (part === "hundred") {
      total = (total || 1) * 100;
      any = true;
      continue;
    }
    const value = WORD_NUMBERS[part];
    if (value === undefined) return null;
    total += value;
    any = true;
  }
  return any && total > 0 ? total : null;
}

function bookPattern() {
  // Longer names first so "Song of Solomon" wins; escape spaces.
  return [...BOOKS]
    .sort((a, b) => b.length - a.length)
    .map((b) => b.replace(/ /g, "\\s+"))
    .join("|");
}

function canonicalBook(raw) {
  const norm = raw.replace(/\s+/g, " ").trim().toLowerCase();
  const found = BOOKS.find((b) => b.toLowerCase() === norm);
  if (found === "Psalms") return "Psalm";
  return found ?? raw.replace(/\s+/g, " ").trim();
}

// Longest words first so "sixteen" matches before "six", "seventeen" before "seven".
const NUM_WORD = Object.keys(WORD_NUMBERS)
  .sort((a, b) => b.length - a.length)
  .join("|");

export function extractScriptures(text) {
  const refs = [];
  const counts = new Map();
  const books = bookPattern();

  const push = (ref) => {
    const key = ref.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (!refs.some((r) => r.toLowerCase() === key)) refs.push(ref);
  };

  // "Psalm 23:1", "Jonah 1:7-16", "John 10", "1 Corinthians 13:4-7"
  const explicit = new RegExp(
    `\\b(${books})\\s+(\\d{1,3})(?::(\\d{1,3})(?:\\s*[-–]\\s*(\\d{1,3}))?)?\\b`,
    "gi",
  );
  for (const m of text.matchAll(explicit)) {
    const book = canonicalBook(m[1] ?? "");
    const chapter = m[2];
    const verse = m[3];
    const verseEnd = m[4];
    let ref = `${book} ${chapter}`;
    if (verse) ref += `:${verse}${verseEnd ? `-${verseEnd}` : ""}`;
    push(ref);
  }

  // Spoken with digits: "Jonah chapter 1 verses 7 through 16", "John chapter 10".
  const chapterDigits = new RegExp(
    `\\b(${books})\\s+chapter\\s+(\\d{1,3})(?:[,\\s]+verses?\\s+(\\d{1,3})(?:\\s*(?:through|thru|to|[-–])\\s*(\\d{1,3}))?)?`,
    "gi",
  );
  for (const m of text.matchAll(chapterDigits)) {
    const book = canonicalBook(m[1] ?? "");
    let ref = `${book} ${m[2]}`;
    if (m[3]) ref += `:${m[3]}${m[4] ? `-${m[4]}` : ""}`;
    push(ref);
  }

  // Spoken with words: "Jonah chapter one verses seven through sixteen",
  //         "John chapter ten", "Psalm chapter twenty three".
  const worded = new RegExp(
    `\\b(${books})\\s+chapter\\s+((?:(?:${NUM_WORD}|hundred)[\\s-]*)+)` +
      `(?:,?\\s*verses?\\s+((?:(?:${NUM_WORD}|hundred)[\\s-]*)+?)` +
      `(?:\\s*(?:through|to|thru|[-–])\\s*((?:(?:${NUM_WORD}|hundred)[\\s-]*)+))?)?`,
    "gi",
  );
  for (const m of text.matchAll(worded)) {
    const book = canonicalBook(m[1] ?? "");
    const chapter = wordToNumber(m[2] ?? "");
    if (!chapter) continue;
    const verse = m[3] ? wordToNumber(m[3]) : null;
    const verseEnd = m[4] ? wordToNumber(m[4]) : null;
    let ref = `${book} ${chapter}`;
    if (verse) ref += `:${verse}${verseEnd ? `-${verseEnd}` : ""}`;
    push(ref);
  }

  // Primary = most mentioned, ties broken by first appearance.
  let primary = refs[0] ?? "";
  let best = 0;
  for (const ref of refs) {
    const c = counts.get(ref.toLowerCase()) ?? 0;
    if (c > best) {
      best = c;
      primary = ref;
    }
  }
  return { primary, refs };
}

export function extractTitle(text) {
  const patterns = [
    /\b(?:message|sermon|talk|teaching)\s+(?:is\s+called|is\s+titled|called|titled|is|today\s+is)\s+["“']?([^."“”'\n]{3,70})/i,
    /\btitle\s+of\s+(?:this|today'?s|the)\s+(?:message|sermon)\s+is\s+["“']?([^."“”'\n]{3,70})/i,
    /\bi['’]?m\s+calling\s+(?:this|it)(?:\s+(?:one|message|sermon))?\s+["“']?([^."“”'\n]{3,70})/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const captured = sanitizeTitle(m[2] ?? m[1] ?? "");
      if (captured.length >= 3) return titleCase(captured);
    }
  }
  return "";
}

/** Keep titles to printable ASCII words, dropping transcription garbage. */
export function sanitizeTitle(input) {
  return input
    .replace(/[^\x20-\x7E'’]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s,;:]+$/, "");
}

function titleCase(input) {
  const small = new Set(["a", "an", "the", "and", "but", "or", "nor", "of", "in", "on", "to", "at", "by", "for"]);
  const words = input.trim().split(/\s+/);
  return words
    .map((w, i) => {
      const lower = w.toLowerCase();
      if (i !== 0 && i !== words.length - 1 && small.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

// Topic -> a themed title, so the fallback never ships the first spoken sentence.
const TOPIC_TITLES = [
  { words: ["fear", "afraid", "worship", "worshi"], title: "Fear Reveals What We Worship" },
  { words: ["grace", "forgive", "forgiveness", "mercy"], title: "Grace That Will Not Let Go" },
  { words: ["hope", "hopeful", "future", "promise"], title: "A Hope That Holds" },
  { words: ["faith", "believe", "trust", "doubt"], title: "Faith When the Ground Shakes" },
  { words: ["love", "loved", "loving", "neighbor"], title: "The Love That Finds Us" },
  { words: ["prayer", "pray", "praying"], title: "Learning to Pray Again" },
  { words: ["identity", "belong", "belonging", "adopted"], title: "Who We Are in Christ" },
  { words: ["suffering", "suffer", "pain", "grief", "sorrow"], title: "God in the Suffering" },
  { words: ["joy", "rejoice", "glad"], title: "A Joy the World Can't Take" },
  { words: ["rest", "weary", "tired", "burden"], title: "Rest for the Weary" },
];

function themedTitle(text, scripture) {
  const lower = text.toLowerCase();
  let best = null;
  let bestCount = 0;
  for (const entry of TOPIC_TITLES) {
    let count = 0;
    for (const w of entry.words) {
      const matches = lower.match(new RegExp(`\\b${w}`, "g"));
      if (matches) count += matches.length;
    }
    if (count > bestCount) {
      bestCount = count;
      best = entry.title;
    }
  }
  if (best && bestCount >= 2) return best;
  if (scripture) {
    const book = scripture.split(/[\s0-9]/)[0];
    if (book) return `Walking Through ${scripture}`;
  }
  return "";
}

function sentences(text) {
  return (text.replace(/\s+/g, " ").match(/[^.!?]+[.!?]+/g) ?? [text])
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function firstSentences(text, count, maxLen) {
  const result = [];
  for (const sentence of sentences(text)) {
    result.push(sentence);
    if (result.length >= count) break;
  }
  let joined = result.join(" ");
  if (joined.length > maxLen) joined = `${joined.slice(0, maxLen - 1).trim()}…`;
  return joined;
}

function topKeywords(text, limit) {
  const stop = new Set(
    ("the a an and or but so because of to in on at for with without from by about as is are was were be " +
      "been being this that these those it its we you they he she i me my our your their his her them us do does did " +
      "not no yes if then than when where who what which how why all any some just like really going gonna know " +
      "want said say says will would could should can may might one two three now today here there whats thats " +
      "god lord jesus christ").split(/\s+/),
  );
  const counts = new Map();
  for (const raw of text.toLowerCase().match(/[a-z][a-z'’]{3,}/g) ?? []) {
    const word = raw.replace(/['’]s$/, "");
    if (stop.has(word) || word.length < 4) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word]) => word);
}

/**
 * @param {string} transcript
 * @param {{speaker:string, series:string, date:string}} input
 * @returns {SeoFields}
 */
export function buildHeuristicSeo(transcript, input) {
  const text = transcript.trim();
  const { primary, refs } = extractScriptures(text);
  const foundTitle = extractTitle(text);
  const themed = foundTitle || themedTitle(text, primary);
  const title = (themed || "Sunday Message").slice(0, 70);
  const excerpt = buildExcerpt(text, primary) || "A message from Citizens Church.";
  const metaDescription =
    (firstSentences(text, 2, 155) || excerpt).slice(0, 155).replace(/\s+\S*$/, "").trim() ||
    excerpt.slice(0, 155);
  const keywords = topKeywords(text, 8);

  // Body: a few short paragraphs built from the opening of the transcript.
  const allSentences = sentences(text);
  const paragraphs = [];
  let bucket = [];
  for (const sentence of allSentences.slice(0, 15)) {
    bucket.push(sentence);
    if (bucket.length >= 3) {
      paragraphs.push(bucket.join(" "));
      bucket = [];
    }
  }
  if (bucket.length) paragraphs.push(bucket.join(" "));
  const body = (paragraphs.length ? paragraphs : [excerpt]).join("\n\n");

  return {
    title,
    slug: slugify(title),
    metaDescription,
    excerpt,
    body,
    scripture: primary,
    scriptureRefs: refs,
    tags: keywords,
    focusKeyphrase: foundTitle ? foundTitle.toLowerCase() : keywords[0] ?? "sermon",
    speaker: input.speaker,
    series: input.series,
    date: input.date,
  };
}

// A two-sentence excerpt in the house style: "The message walks through <ref>
// as ... It treats ... as ...".
function buildExcerpt(text, scripture) {
  const opening = firstSentences(text, 2, 300);
  if (scripture) {
    const lead = `The message walks through ${scripture}.`;
    if (opening) return `${lead} ${opening}`.slice(0, 320);
    return lead;
  }
  return opening;
}
