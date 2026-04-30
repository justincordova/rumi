import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api";
import { CreateInviteBody } from "@rumi/protocol";
import type { CreateInviteResponse, ListInvitesResponse, RoomInvite } from "@rumi/protocol";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  slug: string;
}

export function InviteDialog({ open, onOpenChange, slug }: Props) {
  const [invites, setInvites] = useState<RoomInvite[]>([]);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    apiFetch<ListInvitesResponse>(`/api/rooms/${slug}/invites`).then((r) => setInvites(r.invites));
  }, [open, slug]);

  async function send() {
    const body = CreateInviteBody.parse({ email });
    setSubmitting(true);
    try {
      const res = await apiFetch<CreateInviteResponse>(`/api/rooms/${slug}/invites`, {
        method: "POST",
        body,
      });
      setInvites((cur) => [res.invite, ...cur]);
      setEmail("");
      toast.success("Invite sent");
    } catch (err: unknown) {
      // biome-ignore lint/suspicious/noExplicitAny: error message extraction
      toast.error((err as any)?.message ?? "Couldn't send invite");
    } finally {
      setSubmitting(false);
    }
  }

  async function revoke(id: string) {
    await apiFetch(`/api/rooms/${slug}/invites/${id}`, { method: "DELETE" });
    setInvites((cur) => cur.filter((i) => i.id !== id));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite to room</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="invite-email">Email</Label>
            <div className="flex gap-2">
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <Button onClick={send} disabled={submitting || !email}>
                Send
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Tell them to sign in with this email to join the room.
            </p>
          </div>
          {invites.length > 0 && (
            <div className="space-y-2">
              <Label>Pending invites</Label>
              <ul className="space-y-1">
                {invites.map((inv) => (
                  <li
                    key={inv.id}
                    className="flex items-center justify-between rounded-md border border-border px-2 py-1 text-sm"
                  >
                    <span>{inv.invitedEmail}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => revoke(inv.id)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
