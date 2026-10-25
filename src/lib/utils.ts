import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { getDisplaySection } from "./sectionDisplay";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatClassName(name: string, section?: string | null): string {
  const displaySection = getDisplaySection(name, section);
  return displaySection ? `${name} - ${displaySection}` : name;
}
