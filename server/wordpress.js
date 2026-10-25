// Server-side WordPress REST client. Credentials come from env only and never
// reach the browser. Flywheel strips the Authorization header, so EVERY request
// carries both `Authorization: Basic ...` and `X-Message-Desk: Basic ...` (the
// message-desk-auth.php mu-plugin maps the latter back to PHP_AUTH on Flywheel).
import { readFile } from "node:fs/promises";
import { siteBannerSvg } from "./banner.js";

const DESK_HEADER = "X-Message-Desk";

export function normalizeSite(input, allowHttp) {
  const trimmed = (input ?? "").trim();
  if (!trimmed) throw new Error("WP_URL is not set.");
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url;
  try {
    url = new URL(withProtocol);
  } catch {
    throw new Error(`WP_URL doesn't look like a URL: ${trimmed}`);
  }
  if (url.protocol === "http:") {
    const host = url.hostname;
    const isLocal =
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host);
    if (!allowHttp && !isLocal) {
      throw new Error("WP_URL must be https (set WP_ALLOW_HTTP=1 only for a local/private test site).");
    }
  }
  return url.origin;
}

function basicAuth(user, appPassword) {
  const password = appPassword.replace(/\s+/g, "");
  return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
}

/** Whether to embed a core/audio player in the post content. */
export function shouldEmbedAudio(postType) {
  // The sermon layout renders its own player from sermon_audio_url (as on
  // citizenschur.ch), so only the plain `post` fallback needs an embedded block.
  return postType === "post";
}

/**
 * The sermon_* meta Message Desk writes (matches the real site's structure),
 * plus `sermon_banner_svg`: the wordless banner the user picked in the image
 * step, made template-ready with per-sermon ids. Omitted when there is no
 * banner, so the site falls back to its passage/default banners.
 */
export function buildSermonMeta(seo, { audioUrl = "", transcript = "", bannerSvg = "", bannerId = "" } = {}) {
  const meta = {
    sermon_speaker: seo.speaker,
    sermon_scripture: seo.scripture,
    sermon_series: seo.series,
    sermon_audio_url: audioUrl,
    sermon_transcript: String(transcript || "").replace(/\n\n/g, "\r\n\r\n"),
  };
  const banner = siteBannerSvg(bannerSvg, bannerId);
  if (banner) meta.sermon_banner_svg = banner;
  return meta;
}

export class WpClient {
  constructor(opts) {
    this.origin = normalizeSite(opts.url, opts.allowHttp);
    this.user = opts.user;
    this.appPassword = opts.appPassword;
    if (!this.user || !this.appPassword) throw new Error("WP_USER and WP_APP_PASSWORD are required.");
  }

  authHeaders() {
    const basic = basicAuth(this.user, this.appPassword);
    // Always send both: Authorization for normal hosts, X-Message-Desk for Flywheel.
    return { Authorization: basic, [DESK_HEADER]: basic };
  }

  async fetch(path, init = {}) {
    const url = path.startsWith("http") ? path : `${this.origin}${path}`;
    const headers = { ...this.authHeaders(), ...(init.headers ?? {}) };
    return fetch(url, { ...init, headers });
  }

  async json(path, init) {
    const response = await this.fetch(path, init);
    const text = await response.text();
    if (!response.ok) {
      let message = text.slice(0, 300);
      try {
        const body = JSON.parse(text);
        if (body.message) message = body.message;
      } catch {
        /* keep raw */
      }
      throw new Error(`WordPress ${response.status} on ${path}: ${message}`);
    }
    return JSON.parse(text);
  }

  async probe() {
    let namespaces = [];
    try {
      const root = await this.json("/wp-json/");
      namespaces = root.namespaces ?? [];
    } catch {
      /* site may be unreachable; capabilities check below reports it */
    }

    // Verify login. Do NOT throw on 401 — surface it so the UI can guide the user.
    let authOk = false;
    let authMessage = "";
    let me = {};
    {
      const response = await this.fetch("/wp-json/wp/v2/users/me?context=edit");
      const text = await response.text();
      if (response.ok) {
        authOk = true;
        try {
          me = JSON.parse(text);
        } catch {
          /* ignore */
        }
      } else {
        let code = "";
        try {
          code = String(JSON.parse(text).code ?? "");
        } catch {
          /* ignore */
        }
        if (response.status === 401 && code === "rest_not_logged_in") {
          authMessage =
            "WordPress never saw the login. On Flywheel hosts the Authorization header is stripped — " +
            "install and activate the Message Desk Auth plugin (wordpress/message-desk-auth.php) in " +
            "wp-content/mu-plugins on the site, then retry.";
        } else if (response.status === 401 || response.status === 403) {
          authMessage = "Login failed — check WP_USER and the Application Password.";
        } else {
          authMessage = `Site returned ${response.status} for the login check.`;
        }
      }
    }

    let postType = "sermon";
    let restBase = "sermon";
    let taxonomies = [];
    try {
      const types = await this.json("/wp-json/wp/v2/types");
      const hasSermon = Boolean(types.sermon);
      postType = hasSermon ? "sermon" : "post";
      const typeInfo = types[postType] ?? {};
      restBase = typeInfo.rest_base || postType;
      taxonomies = typeInfo.taxonomies ?? [];
    } catch {
      /* fall back to sermon defaults */
    }

    let theme = "";
    try {
      const themes = await this.json("/wp-json/wp/v2/themes?status=active");
      theme = themes[0]?.stylesheet ?? "";
    } catch {
      /* themes endpoint may be restricted */
    }

    const caps = me.capabilities ?? {};
    const roles = me.roles ?? [];
    return {
      site: this.origin,
      authOk,
      authMessage,
      user: {
        id: Number(me.id ?? 0),
        name: String(me.name ?? ""),
        roles,
        canEdit: Boolean(caps.edit_posts),
        canUpload: Boolean(caps.upload_files),
        canPublish: Boolean(caps.publish_posts),
      },
      namespaces,
      postType,
      restBase,
      taxonomies,
      theme,
      seo: {
        yoast: namespaces.some((n) => /^yoast/i.test(n)),
        rankmath: namespaces.some((n) => /rank[-_]?math/i.test(n)),
      },
    };
  }

  async uploadMedia(filePath, filename, mime, altText) {
    const bytes = await readFile(filePath);
    const media = await this.json("/wp-json/wp/v2/media", {
      method: "POST",
      headers: {
        "Content-Type": mime,
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
      body: bytes,
    });
    if (altText) {
      await this.json(`/wp-json/wp/v2/media/${media.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alt_text: altText }),
      });
    }
    return media;
  }

  /** Look up or create a taxonomy term, returning its id. */
  async ensureTerm(taxonomyRestBase, name) {
    try {
      const existing = await this.json(
        `/wp-json/wp/v2/${taxonomyRestBase}?search=${encodeURIComponent(name)}&per_page=100`,
      );
      const match = existing.find((t) => t.name.toLowerCase() === name.toLowerCase());
      if (match) return match.id;
      const created = await this.json(`/wp-json/wp/v2/${taxonomyRestBase}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      return created.id;
    } catch {
      return null;
    }
  }

  async createPost(restBase, payload) {
    return this.json(`/wp-json/wp/v2/${restBase}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  editLink(id) {
    return `${this.origin}/wp-admin/post.php?post=${id}&action=edit`;
  }
}

function escapeHtml(input) {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Build Gutenberg block markup: paragraphs, plus an optional leading audio block. */
export function buildContent(body, opts) {
  const blocks = [];
  if (opts.embedAudio && opts.audioUrl) {
    const idAttr = opts.audioMediaId ? ` {"id":${opts.audioMediaId}}` : "";
    blocks.push(
      `<!-- wp:audio${idAttr} -->\n<figure class="wp-block-audio"><audio controls src="${escapeHtml(opts.audioUrl)}"></audio></figure>\n<!-- /wp:audio -->`,
    );
  }
  for (const para of body.split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean)) {
    blocks.push(`<!-- wp:paragraph -->\n<p>${escapeHtml(para).replace(/\n/g, "<br>")}</p>\n<!-- /wp:paragraph -->`);
  }
  return blocks.join("\n\n");
}
