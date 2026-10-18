export type PostStatus = "draft" | "publish";

export type DeskSettings = {
  siteUrl: string;
  username: string;
  appPassword: string;
  speaker: string;
  series: string;
  serviceTime: string;
  status: PostStatus;
};

export const DEFAULT_SETTINGS: DeskSettings = {
  siteUrl: "https://citizenschur.ch",
  username: "",
  appPassword: "",
  speaker: "",
  series: "",
  serviceTime: "10:00",
  status: "draft",
};

const KEY = "message-desk-settings-v1";

export function loadSettings(): DeskSettings {
  if (typeof localStorage === "undefined") return { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<DeskSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      status: parsed.status === "publish" ? "publish" : "draft",
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: DeskSettings): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(settings));
}
