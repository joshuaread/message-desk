// Two safety guards.
//
// 1. Publish guard: status=publish is only allowed with an explicit
//    confirmation ({publish:true, confirm:"publish"}). Everything else is a
//    draft.
// 2. Live-site guard: the e2e/test harness must never touch the real site.
//    Any WP_URL whose host is citizenschur.ch (or a subdomain) is refused.

/**
 * @returns {{ok:true, status:"draft"|"publish"} | {ok:false, error:string}}
 */
export function resolvePublishStatus(requestedStatus, publish, confirm) {
  const wantsPublish = requestedStatus === "publish" || publish === true;
  if (wantsPublish) {
    // Require BOTH an affirmative publish flag and the typed confirm token.
    if (publish !== true || confirm !== "publish") {
      return {
        ok: false,
        error: 'Publishing requires {"publish": true, "confirm": "publish"}.',
      };
    }
    return { ok: true, status: "publish" };
  }
  return { ok: true, status: "draft" };
}

const LIVE_HOST = "citizenschur.ch";

/** Extract a hostname from a bare host or a full URL. */
export function hostOf(wpUrl) {
  const trimmed = String(wpUrl ?? "").trim();
  if (!trimmed) return "";
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withProtocol).hostname.toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}

/** True when the URL points at the real Citizens Church site. */
export function isLiveSite(wpUrl) {
  const host = hostOf(wpUrl);
  return host === LIVE_HOST || host.endsWith(`.${LIVE_HOST}`);
}

/** Throw when a test/e2e run is pointed at the real site. */
export function assertNotLiveSite(wpUrl) {
  if (isLiveSite(wpUrl)) {
    throw new Error(
      `Refusing to run tests against the real site (${hostOf(wpUrl)}). ` +
        "Tests only run against a throwaway WordPress.",
    );
  }
}
