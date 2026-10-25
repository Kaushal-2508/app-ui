import { useEffect, useRef, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getAvatarObjectUrl } from "@/lib/avatarStore";
import { getInitials } from "@/lib/initials";
import { cn } from "@/lib/utils";

export interface UserAvatarProps {
  name?: string | null;
  email?: string | null;
  /** profiles.avatar_path. Null or unresolved renders initials, exactly as before photos existed. */
  avatarPath?: string | null;
  className?: string;
  fallbackClassName?: string;
}

/**
 * The one avatar component. Fetches the photo only once it is on screen, so a
 * 40-row page costs the ~10 visible rows rather than 40, and degrades to
 * initials on any failure.
 */
export function UserAvatar({
  name,
  email,
  avatarPath,
  className,
  fallbackClassName,
}: UserAvatarProps) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (visible) return;
    const el = rootRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
      },
      { rootMargin: "100px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    setUrl(null);
    if (!visible || !avatarPath) return;
    let cancelled = false;
    void getAvatarObjectUrl(avatarPath).then((resolved) => {
      if (!cancelled) setUrl(resolved);
    });
    return () => { cancelled = true; };
  }, [visible, avatarPath]);

  return (
    <Avatar ref={rootRef} className={className}>
      {url ? <AvatarImage src={url} alt={name ?? ""} /> : null}
      <AvatarFallback className={cn(fallbackClassName)}>
        {getInitials(name, email)}
      </AvatarFallback>
    </Avatar>
  );
}
