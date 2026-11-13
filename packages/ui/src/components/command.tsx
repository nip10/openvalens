import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { SearchIcon } from "lucide-react";

import { cn } from "@openvalens/ui/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@openvalens/ui/components/dialog";

/**
 * shadcn's `Command` (cmdk) in the Bloom look: a searchable list with
 * keyboard navigation (arrows, Home/End, Enter) and `combobox`/`listbox`
 * semantics for screen readers.
 */
function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        "flex h-full w-full flex-col overflow-hidden rounded-3xl bg-popover text-popover-foreground",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A `Command` in a dialog. The title and description are for screen readers
 * (the input's placeholder says what to type).
 */
function CommandDialog({
  title,
  description,
  children,
  className,
  commandProps,
  showCloseButton = false,
  ...props
}: React.ComponentProps<typeof Dialog> & {
  title: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
  commandProps?: React.ComponentProps<typeof CommandPrimitive>;
  showCloseButton?: boolean;
}) {
  return (
    <Dialog {...props}>
      <DialogContent
        className={cn("top-[12vh] translate-y-0 overflow-hidden rounded-3xl p-0", className)}
        showCloseButton={showCloseButton}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <Command {...commandProps}>{children}</Command>
      </DialogContent>
    </Dialog>
  );
}

function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div
      data-slot="command-input-wrapper"
      className="flex h-14 items-center gap-3 border-b border-rule px-4"
    >
      <SearchIcon className="size-5 shrink-0 text-ink-3" aria-hidden="true" />
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          "flex h-12 w-full bg-transparent py-3 text-base text-ink outline-hidden placeholder:text-ink-3 disabled:cursor-not-allowed disabled:opacity-55",
          className,
        )}
        {...props}
      />
    </div>
  );
}

function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        "max-h-[min(60vh,28rem)] scroll-py-2 overflow-x-hidden overflow-y-auto p-2",
        className,
      )}
      {...props}
    />
  );
}

function CommandEmpty({ ...props }: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className="py-6 text-center text-sm text-ink-3"
      {...props}
    />
  );
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        "overflow-hidden pb-2 text-ink [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[0.8125rem] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-ink-3",
        className,
      )}
      {...props}
    />
  );
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn("-mx-2 my-1 h-px bg-rule", className)}
      {...props}
    />
  );
}

function CommandItem({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "relative flex min-h-11 cursor-default items-center gap-3 rounded-2xl px-3 py-2 text-[0.9375rem] text-ink-2 outline-hidden select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-55 data-[selected=true]:bg-paper-2 data-[selected=true]:text-ink [&_svg]:pointer-events-none [&_svg]:shrink-0 [&>svg:not([class*='size-'])]:size-[18px] [&>svg:not([class*='text-'])]:text-ink-3",
        className,
      )}
      {...props}
    />
  );
}

function CommandShortcut({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn("ml-auto text-xs text-ink-3", className)}
      {...props}
    />
  );
}

export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
};
