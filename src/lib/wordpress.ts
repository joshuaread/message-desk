export type WpCreds = {
  siteUrl: string;
  username: string;
  appPassword: string;
};

export type RecentSermon = {
  id: number;
  title: string;
  date: string;
  link: string;
  speaker: string;
};

export type MediaResult = { id: number; source_url: string };
export type SermonResult = { id: number; link: string; status: string; audioSaved: boolean };

export function normalizeSite(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Add the church site URL.");
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    throw new Error("That site URL doesn’t look right.");
  }
  if (url.protocol !== "https:") throw new Error("The church site needs to be https.");
  return url.origin;
}

function authHeader(creds: WpCreds): string {
  const password = creds.appPassword.replace(/\s+/g, "");
  const bytes = new TextEncoder().encode(`${creds.username}:${password}`);
  let binary = "";
  const stride = 8192;
  for (let index = 0; index < bytes.length; index += stride) {
    binary += String.fromCharCode(...bytes.subarray(index, index + stride));
  }
  return `Basic ${btoa(binary)}`;
}

function api(creds: WpCreds, path: string): string {
  return `${normalizeSite(creds.siteUrl)}/wp-json/wp/v2${path}`;
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, '"')
    .replace(/&#8217;|&rsquo;/g, "’")
    .replace(/&#8211;|&ndash;/g, "–")
    .replace(/&#038;|&middot;/g, "·")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function wpMessage(body: unknown, status: number): string {
  const record = body && typeof body === "object" ? (body as { message?: unknown }) : {};
  const message = typeof record.message === "string" ? stripHtml(record.message) : "";
  if (status === 401) {
    return "WordPress rejected that login. Use an Application Password from Users → Profile — not the password you type to log in.";
  }
  if (status === 403) return message || "That user can’t upload or create sermons.";
  if (message) return message;
  return `The site returned an error (${status}).`;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text.slice(0, 240) };
  }
}

export async function testConnection(creds: WpCreds): Promise<{ name: string }> {
  if (!creds.username.trim() || !creds.appPassword.trim()) {
    throw new Error("Add the WordPress username and application password.");
  }
  const response = await fetch(api(creds, "/users/me?context=edit"), {
    headers: { Authorization: authHeader(creds) },
  });
  const body = await readJson(response);
  if (!response.ok) throw new Error(wpMessage(body, response.status));
  const name = body && typeof body === "object" && "name" in body ? String((body as { name: unknown }).name) : creds.username;
  return { name };
}

export function uploadMedia(
  creds: WpCreds,
  blob: Blob,
  filename: string,
  onProgress?: (ratio: number) => void,
): Promise<MediaResult> {
  const safe = filename.replace(/["\\]/g, "").replace(/[^\w.\-]+/g, "-");
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", api(creds, "/media"));
    xhr.setRequestHeader("Authorization", authHeader(creds));
    xhr.setRequestHeader("Content-Type", "audio/mpeg");
    xhr.setRequestHeader("Content-Disposition", `attachment; filename="${safe}"`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      let body: unknown = {};
      try {
        body = JSON.parse(xhr.responseText) as unknown;
      } catch {
        body = { message: xhr.responseText.slice(0, 240) };
      }
      const record = body && typeof body === "object" ? (body as { id?: unknown; source_url?: unknown }) : {};
      if (xhr.status >= 200 && xhr.status < 300 && typeof record.source_url === "string" && typeof record.id === "number") {
        resolve({ id: record.id, source_url: record.source_url });
        return;
      }
      reject(new Error(wpMessage(body, xhr.status)));
    };
    xhr.onerror = () => reject(new Error("Couldn’t reach the church site. Check the URL, then try again."));
    xhr.send(blob);
  });
}

export async function createSermon(
  creds: WpCreds,
  sermon: {
    title: string;
    status: "draft" | "publish";
    date: string;
    summary: string;
    speaker: string;
    scripture: string;
    series: string;
    audioUrl: string;
    transcript: string;
  },
): Promise<SermonResult> {
  const payload: Record<string, unknown> = {
    title: { raw: sermon.title.trim() },
    status: sermon.status,
    date: sermon.date,
    meta: {
      sermon_speaker: sermon.speaker.trim(),
      sermon_scripture: sermon.scripture.trim(),
      sermon_series: sermon.series.trim(),
      sermon_audio_url: sermon.audioUrl,
      sermon_transcript: sermon.transcript,
    },
  };
  if (sermon.summary.trim()) payload.excerpt = { raw: sermon.summary.trim() };
  const response = await fetch(api(creds, "/sermon"), {
    method: "POST",
    headers: {
      Authorization: authHeader(creds),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const body = await readJson(response);
  if (!response.ok) throw new Error(wpMessage(body, response.status));
  const record = body as {
    id?: number;
    link?: string;
    status?: string;
    meta?: { sermon_audio_url?: string };
  };
  if (!record.id || !record.link) throw new Error("WordPress didn’t return the new sermon.");
  return {
    id: record.id,
    link: record.link,
    status: record.status || sermon.status,
    audioSaved: Boolean(record.meta?.sermon_audio_url),
  };
}

export async function fetchRecentSermons(siteUrl: string): Promise<RecentSermon[]> {
  const origin = normalizeSite(siteUrl || "https://citizenschur.ch");
  const response = await fetch(`${origin}/wp-json/wp/v2/sermon?per_page=4&orderby=date&order=desc`);
  if (!response.ok) return [];
  const body = (await response.json()) as Array<{
    id: number;
    link: string;
    date: string;
    title?: { rendered?: string };
    meta?: { sermon_speaker?: string };
  }>;
  if (!Array.isArray(body)) return [];
  return body.map((item) => ({
    id: item.id,
    title: stripHtml(item.title?.rendered || "Untitled"),
    date: item.date,
    link: item.link,
    speaker: item.meta?.sermon_speaker || "",
  }));
}

export function adminEditUrl(siteUrl: string, id: number): string {
  return `${normalizeSite(siteUrl)}/wp-admin/post.php?post=${id}&action=edit`;
}
