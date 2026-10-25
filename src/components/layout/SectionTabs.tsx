import { useLocation, useNavigate } from "react-router-dom";

import { MobileTabs } from "@/components/shared/nav";
import { useIsMobile } from "@/hooks/use-mobile";
import { isNativePlatform } from "@/lib/native";
import { cn } from "@/lib/utils";
import { isFocusedFlow } from "./MobileBottomNav";
import { activeNavUrl, useNavGroups } from "./useNavGroups";

/**
 * Phone only (2026-10-21, Tushar): a section's pages as tabs at the top of the
 * page, once you have entered that section from the bottom bar or More. The
 * desktop sidebar still lists every page, so desktop renders nothing.
 *
 * Shown only on a section page itself (the path IS one of the section's nav
 * urls), never on a detail page under it or inside a focused flow, and only
 * when the section has more than one page.
 *
 * Pinned under the app bar on the web, riding --app-bar-offset like the
 * command center's strip. Not pinned inside the app: a top strip trembled on
 * iOS while the page scrolled (index.css, .native-shell .native-bottom-bar).
 */
export function SectionTabs() {
  const isMobile = useIsMobile();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const groups = useNavGroups();

  if (!isMobile || isFocusedFlow(pathname)) return null;
  const url = activeNavUrl(groups, pathname);
  if (!url || url !== pathname) return null;
  const group = groups.find((g) => g.items.some((i) => i.url === url));
  if (!group || group.items.length < 2) return null;

  return (
    <nav
      aria-label={`${group.group} pages`}
      className={cn(
        "tab-strip-frost -mx-3 -mt-3 mb-1 px-3 py-2 border-b border-surface-stroke",
        !isNativePlatform() &&
          "sticky top-[var(--app-bar-offset,var(--app-bar-height,61px))] z-10 transition-[top] duration-300 ease-in-out motion-reduce:transition-none",
      )}
    >
      <MobileTabs
        value={url}
        onValueChange={(to) => navigate(to)}
        options={group.items.map((i) => ({ value: i.url, label: i.title }))}
        density="compact"
      />
    </nav>
  );
}
