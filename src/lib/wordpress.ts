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

const DESK_HEADER = "X-Message-Desk";
const PLUGIN_HINT =
  "The password is fine. Flywheel drops it before WordPress sees it. In WordPress, upload and activate the Message Desk Auth plugin, then try again.";

type AuthMode = "standard" | "flywheel";
let preferred: AuthMode | null = null;

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

function applyAuth(target: Headers | XMLHttpRequest, creds: WpCreds, mode: AuthMode): void {
  const basic = authHeader(creds);
  if (target instanceof Headers) {
    target.set("Authorization", basic);
    if (mode === "flywheel") target.set(DESK_HEADER, basic);
    return;
  }
  target.setRequestHeader("Authorization", basic);
  if (mode === "flywheel") target.setRequestHeader(DESK_HEADER, basic);
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

function bodyCode(body: unknown): string {
  if (!body || typeof body !== "object" || !("code" in body)) return "";
  return String((body as { code: unknown }).code);
}

function wpMessage(body: unknown, status: number): string {
  const record = body && typeof body === "object" ? (body as { message?: unknown }) : {};
  const message = typeof record.message === "string" ? stripHtml(record.message) : "";
  const code = bodyCode(body);
  if (code === "rest_not_logged_in" || (status === 401 && /not currently logged in/i.test(message))) {
    return PLUGIN_HINT;
  }
  if (status === 401) {
    return "WordPress rejected that login. Use the username from Users → Profile, and an Application Password from that same screen — not the password you type to log in.";
  }
  if (status === 403) return message || "That user can’t upload or create sermons.";
  if (message) return message;
  return `The site returned an error (${status}).`;
}

function loginWasDropped(body: unknown, status: number): boolean {
  const code = bodyCode(body);
  return code === "rest_not_logged_in" || code === "rest_cannot_create";
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

async function resolveMode(creds: WpCreds): Promise<AuthMode> {
  if (!creds.username.trim() || !creds.appPassword.trim()) {
    throw new Error("Add the WordPress username and application password.");
  }
  if (preferred) return preferred;
  const standard = await fetch(api(creds, "/users/me?context=edit"), {
    headers: (() => {
      const headers = new Headers();
      applyAuth(headers, creds, "standard");
      return headers;
    })(),
  });
  if (standard.ok) {
    preferred = "standard";
    return preferred;
  }
  const body = await readJson(standard);
  if (!loginWasDropped(body, standard.status)) throw new Error(wpMessage(body, standard.status));
  let retry: Response;
  try {
    const headers = new Headers();
    applyAuth(headers, creds, "flywheel");
    retry = await fetch(api(creds, "/users/me?context=edit"), { headers });
  } catch (error) {
    if (error instanceof TypeError) throw new Error(PLUGIN_HINT);
    throw error;
  }
  if (!retry.ok) {
    const retryBody = await readJson(retry);
    if (loginWasDropped(retryBody, retry.status)) throw new Error(PLUGIN_HINT);
    throw new Error(wpMessage(retryBody, retry.status));
  }
  preferred = "flywheel";
  return preferred;
}

export async function testConnection(creds: WpCreds): Promise<{ name: string }> {
  preferred = null;
  const mode = await resolveMode(creds);
  const headers = new Headers();
  applyAuth(headers, creds, mode);
  const response = await fetch(api(creds, "/users/me?context=edit"), { headers });
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
  return resolveMode(creds).then(
    (mode) =>
      new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", api(creds, "/media"));
        applyAuth(xhr, creds, mode);
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
          if (loginWasDropped(body, xhr.status)) {
            preferred = null;
            reject(new Error(PLUGIN_HINT));
            return;
          }
          reject(new Error(wpMessage(body, xhr.status)));
        };
        xhr.onerror = () => reject(new Error(mode === "flywheel" ? PLUGIN_HINT : "Couldn’t reach the church site. Check the URL, then try again."));
        xhr.send(blob);
      }),
  );
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
  const mode = await resolveMode(creds);
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
  const headers = new Headers({ "Content-Type": "application/json" });
  applyAuth(headers, creds, mode);
  let response: Response;
  try {
    response = await fetch(api(creds, "/sermon"), {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  } catch (error) {
    if (error instanceof TypeError) throw new Error(PLUGIN_HINT);
    throw error;
  }
  const body = await readJson(response);
  if (!response.ok) {
    if (loginWasDropped(body, response.status)) {
      preferred = null;
      throw new Error(PLUGIN_HINT);
    }
    throw new Error(wpMessage(body, response.status));
  }
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
