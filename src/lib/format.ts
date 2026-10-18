export function formatTime(seconds: number, withTenths = true): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const whole = Math.floor(safe);
  const tenths = Math.min(9, Math.floor((safe - whole) * 10 + 1e-6));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  const body =
    hours > 0
      ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
      : `${minutes}:${String(secs).padStart(2, "0")}`;
  return withTenths ? `${body}.${tenths}` : body;
}

export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

export function parseTime(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  const parts = trimmed.split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  if (parts.some((part) => part === "" || Number.isNaN(Number(part)))) return null;
  if (parts.length === 2) return Number(parts[0]) * 60 + Number(parts[1]);
  return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatCost(seconds: number): string {
  const dollars = (Math.max(0, seconds) / 3600) * 0.1;
  if (dollars < 0.01) return "under 1¢";
  return `about ${dollars.toLocaleString("en-US", { style: "currency", currency: "USD" })}`;
}

export function localDateInput(timeMs: number): string {
  const date = new Date(timeMs);
  if (Number.isNaN(date.getTime()) || timeMs < 86400000) {
    const today = new Date();
    return isoDate(today);
  }
  return isoDate(date);
}

export function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function sermonFileName(speaker: string, dateInput: string): string {
  const who = (speaker || "Message")
    .trim()
    .replace(/[^\w]+/g, "-")
    .replace(/^-+|-+$/g, "") || "Message";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateInput);
  const date = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : new Date();
  const year = String(date.getFullYear()).slice(2);
  return `${who}-${date.getMonth() + 1}-${date.getDate()}-${year}-cleaned.mp3`;
}

export function confidenceLabel(confidence: number): string {
  if (confidence >= 0.72) return "Fairly sure";
  if (confidence >= 0.45) return "Best guess";
  return "Not sure";
}
