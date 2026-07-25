import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date) {
  return new Date(date).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

const TAG_COLORS = [
  "bg-purple-100 text-purple-700 border border-current/25",
  "bg-pink-100 text-pink-700 border border-current/25",
  "bg-indigo-100 text-indigo-700 border border-current/25",
  "bg-teal-100 text-teal-700 border border-current/25",
  "bg-amber-100 text-amber-700 border border-current/25",
];
export function getTagColor(tag: string) {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) & 0xffff;
  return TAG_COLORS[h % TAG_COLORS.length];
}

export function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function getTypeColor(type: string) {
  const map: Record<string, string> = {
    figma: "bg-purple-100 text-purple-700 border border-current/25",
    code: "bg-blue-100 text-blue-700 border border-current/25",
    document: "bg-yellow-100 text-yellow-700 border border-current/25",
    image: "bg-green-100 text-green-700 border border-current/25",
    video: "bg-red-100 text-red-700 border border-current/25",
    link: "bg-orange-100 text-orange-700 border border-current/25",
  };
  return map[type?.toLowerCase()] ?? "bg-gray-100 text-gray-700 border border-current/25";
}
