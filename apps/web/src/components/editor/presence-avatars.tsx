import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import { User } from "lucide-react";
import { useEffect, useState } from "react";

interface AwarenessUser {
  clientId: number;
  user_id?: string;
  display_name?: string;
  avatar_url?: string | null;
  color?: string;
  isGuest?: boolean;
}

interface Props {
  provider: HocuspocusProvider;
  max?: number;
}

export function PresenceAvatars({ provider, max = 5 }: Props) {
  const [users, setUsers] = useState<AwarenessUser[]>([]);

  useEffect(() => {
    if (!provider.awareness) return;

    function sync() {
      const states = provider.awareness?.getStates() ?? new Map();
      const seen = new Set<string>();
      const out: AwarenessUser[] = [];
      for (const [clientId, state] of states) {
        const uid = state.user_id as string | undefined;
        if (!uid || seen.has(uid)) continue;
        seen.add(uid);
        out.push({
          clientId,
          user_id: uid,
          display_name: state.display_name as string | undefined,
          avatar_url: state.avatar_url as string | null | undefined,
          color: state.color as string | undefined,
          isGuest: typeof uid === "string" && uid.startsWith("guest:"),
        });
      }
      setUsers(out);
    }

    provider.awareness.on("change", sync);
    sync();
    return () => provider.awareness?.off("change", sync);
  }, [provider]);

  if (users.length === 0) return null;

  const visible = users.slice(0, max);
  const overflow = users.length - visible.length;
  const label =
    users.length === 1 ? "1 person in this room" : `${users.length} people in this room`;

  return (
    <ul className="flex items-center -space-x-2" aria-label={label}>
      {visible.map((u) => {
        const personName = u.isGuest ? "Guest" : (u.display_name ?? "Anonymous");
        return (
          <li key={u.user_id} title={personName} aria-label={personName}>
            <Avatar
              aria-hidden
              className="h-7 w-7 ring-2 ring-background cursor-default shrink-0 transition-transform hover:scale-110 hover:z-10"
              style={u.color ? ({ "--presence-ring": u.color } as React.CSSProperties) : undefined}
            >
              {u.isGuest ? (
                <AvatarFallback
                  className="text-[10px] text-muted-foreground"
                  style={{ background: u.color ? undefined : "var(--color-muted)" }}
                >
                  <User className="h-3.5 w-3.5" />
                </AvatarFallback>
              ) : (
                <>
                  <AvatarImage src={u.avatar_url ?? undefined} alt="" />
                  <AvatarFallback
                    className="text-[10px] font-semibold text-white"
                    style={{ background: u.color ?? "var(--color-muted-foreground)" }}
                  >
                    {(u.display_name?.[0] ?? "?").toUpperCase()}
                  </AvatarFallback>
                </>
              )}
            </Avatar>
          </li>
        );
      })}
      {overflow > 0 && (
        <li
          className="flex h-7 w-7 items-center justify-center rounded-full bg-muted ring-2 ring-background text-[10px] font-medium text-muted-foreground shrink-0 select-none"
          aria-label={`${overflow} more`}
        >
          +{overflow}
        </li>
      )}
    </ul>
  );
}
