import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOut, useSession } from "@/lib/auth";
import { useNavigate } from "@tanstack/react-router";
import { CreditCard, Settings, Zap } from "lucide-react";

export function DashboardDropdown() {
  const { user } = useSession();
  const navigate = useNavigate();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label="Account menu">
          <Avatar className="h-8 w-8">
            <AvatarImage src={user?.avatarUrl ?? undefined} alt="" />
            <AvatarFallback>{user?.displayName?.[0] ?? "?"}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={16} className="w-48">
        <DropdownMenuLabel className="font-medium text-sm">{user?.displayName}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate({ to: "/pricing" })}>
          <Zap className="h-3.5 w-3.5 mr-2" />
          Upgrade
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            navigate({ to: "/settings", search: { tab: "billing", checkout: undefined } })
          }
        >
          <CreditCard className="h-3.5 w-3.5 mr-2" />
          Billing
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            navigate({ to: "/settings", search: { tab: "general", checkout: undefined } })
          }
        >
          <Settings className="h-3.5 w-3.5 mr-2" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut}>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
