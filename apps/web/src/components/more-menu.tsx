import { Button } from "@openvalens/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@openvalens/ui/components/dropdown-menu";
import { type LucideIcon, MoreHorizontal } from "lucide-react";

export type MoreMenuItem = {
  label: string;
  onSelect: () => void;
  icon?: LucideIcon;
  /** Delete and the like: set apart at the bottom, in the destructive tone. */
  destructive?: boolean;
  disabled?: boolean;
};

/**
 * The "⋯" on a card for its less common actions (pause, delete), so the card
 * keeps one clear action in its footer.
 */
export function MoreMenu({ label, items }: { label: string; items: readonly MoreMenuItem[] }) {
  const plain = items.filter((item) => !item.destructive);
  const destructive = items.filter((item) => item.destructive);
  const row = (item: MoreMenuItem) => {
    const Icon = item.icon;
    return (
      <DropdownMenuItem
        key={item.label}
        variant={item.destructive ? "destructive" : "default"}
        disabled={item.disabled}
        onSelect={item.onSelect}
      >
        {Icon ? <Icon aria-hidden="true" /> : null}
        {item.label}
      </DropdownMenuItem>
    );
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="icon" variant="ghost" aria-label={label} title={label}>
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44 rounded-2xl border-rule p-1.5">
        {plain.map(row)}
        {plain.length > 0 && destructive.length > 0 ? <DropdownMenuSeparator /> : null}
        {destructive.map(row)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
