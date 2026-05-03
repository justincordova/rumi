import { apiFetch } from "@/lib/api";
import { useRoomsStore } from "@/stores/rooms";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { CreateRoomBody } from "@rumi/protocol";
import type { CreateRoomResponse } from "@rumi/protocol";
import { useNavigate } from "@tanstack/react-router";
import { Globe, Lock, Users } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const VISIBILITY_OPTIONS = [
  {
    value: "open" as const,
    label: "Open",
    icon: Globe,
    desc: "Anyone with the link can join and edit.",
  },
  {
    value: "private" as const,
    label: "Private",
    icon: Lock,
    desc: "Invite only.",
  },
];

const GUEST_ACCESS_OPTIONS: { value: "none" | "view" | "edit"; label: string; desc: string }[] = [
  { value: "none", label: "Sign-in required", desc: "Guests must sign in to access." },
  { value: "view", label: "Can view", desc: "Guests can read but not edit." },
  { value: "edit", label: "Can edit", desc: "Guests can view and edit freely." },
];

export function CreateRoomDialog({ open, onOpenChange }: Props) {
  const nav = useNavigate();
  const addRoom = useRoomsStore((s) => s.addRoom);
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<"open" | "private">("open");
  const [guestAccess, setGuestAccess] = useState<"none" | "view" | "edit">("none");
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setVisibility("open");
      setGuestAccess("none");
      setSubmitting(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const activeDesc = VISIBILITY_OPTIONS.find((o) => o.value === visibility)?.desc ?? "";

  const submit = useCallback(async () => {
    if (submitting) return;
    const body = CreateRoomBody.parse({
      name: name.trim() || undefined,
      visibility,
      guestAccess,
    });
    setSubmitting(true);
    try {
      const res = await apiFetch<CreateRoomResponse>("/api/rooms", {
        method: "POST",
        body,
      });
      addRoom(res.room);
      toast.success("Room created");
      onOpenChange(false);
      queueMicrotask(() => {
        nav({ to: "/r/$slug", params: { slug: res.room.slug }, search: { tab: undefined } });
      });
    } catch (err: unknown) {
      // biome-ignore lint/suspicious/noExplicitAny: error message extraction
      toast.error((err as any)?.message ?? "Couldn't create room");
    } finally {
      setSubmitting(false);
    }
  }, [submitting, name, visibility, guestAccess, addRoom, onOpenChange, nav]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    },
    [submit],
  );

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-[15vh] z-50 w-full max-w-md -translate-x-1/2 rounded-xl border border-border bg-surface p-0 shadow-lg outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-98 data-[state=open]:zoom-in-98 duration-150"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="px-5 pt-5 pb-2" onKeyDown={handleKeyDown}>
            <input
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Room name"
              maxLength={100}
              className="w-full bg-transparent text-lg font-medium tracking-tight text-foreground placeholder:text-muted-foreground/60 outline-none ring-0 focus:ring-0 border-0 focus:border-0 caret-primary"
            />
            {name.trim().length === 0 && (
              <p className="mt-1.5 text-[12px] text-muted-foreground/50">
                Leave blank for a generated name like{" "}
                <span className="font-mono text-muted-foreground/70">quiet-fox-42</span>
              </p>
            )}
          </div>

          <div className="px-5 pb-4 space-y-2.5">
            <div className="flex h-9 rounded-lg bg-muted p-1 gap-0.5">
              {VISIBILITY_OPTIONS.map((opt) => {
                const active = visibility === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      setVisibility(opt.value);
                      if (opt.value === "private") setGuestAccess("none");
                    }}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-md text-[13px] font-medium transition-all duration-150 ${
                      active
                        ? "bg-surface text-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground/70"
                    }`}
                  >
                    <opt.icon className="h-3.5 w-3.5" />
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[12px] text-muted-foreground/60 leading-snug">{activeDesc}</p>

            {visibility === "open" && (
              <div className="pt-1">
                <div className="flex items-center gap-1.5 mb-2">
                  <Users className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[12px] font-medium text-muted-foreground">
                    Guest access
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  {GUEST_ACCESS_OPTIONS.map((opt) => {
                    const active = guestAccess === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setGuestAccess(opt.value)}
                        className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                          active
                            ? "bg-primary/10 text-primary"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        }`}
                      >
                        <span
                          className={`h-3.5 w-3.5 shrink-0 rounded-full border flex items-center justify-center ${
                            active ? "border-primary" : "border-muted-foreground/40"
                          }`}
                        >
                          {active && <span className="h-1.5 w-1.5 rounded-full bg-primary block" />}
                        </span>
                        <span className="font-medium">{opt.label}</span>
                        <span className="ml-auto text-[11px] opacity-60">{opt.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-border px-5 py-3 flex justify-end">
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="inline-flex items-center justify-center h-8 px-4 rounded-md bg-primary text-primary-foreground text-[13px] font-medium transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none"
            >
              {submitting ? "Creating\u2026" : "Create room"}
            </button>
          </div>

          <DialogPrimitive.Title className="sr-only">Create room</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Create a new collaborative room.
          </DialogPrimitive.Description>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
