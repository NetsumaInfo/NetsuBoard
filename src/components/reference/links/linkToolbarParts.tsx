// Small building blocks of the link toolbar: a neutral icon button with its tooltip, a button that
// opens a popover, and a line preview icon. Shared by LinkEditorMenu and LinkStyleControls.

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function LineIcon({ width = 2, dashed = false }: { width?: number; dashed?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden>
      <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth={Math.min(6, width)} strokeLinecap="round" strokeDasharray={dashed ? "2.5 2.5" : undefined} />
    </svg>
  );
}

export function ToolButton({ label, onClick, pressed, children, className }: {
  label: string; onClick: () => void; pressed?: boolean; children: ReactNode; className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            aria-pressed={pressed}
            onClick={onClick}
            className={cn("text-muted-foreground hover:text-foreground aria-pressed:bg-muted aria-pressed:text-foreground", className)}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

// A toolbar button opening a popover; `onOpenChange` lets a panel act when it closes.
export function PopoverButton({ label, trigger, children, className, onOpenChange }: {
  label: string;
  trigger: ReactNode;
  children: ReactNode;
  className?: string;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Popover onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={<Button variant="ghost" size="icon-xs" aria-label={label} className="text-muted-foreground hover:text-foreground" />}
            />
          }
        >
          {trigger}
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <PopoverContent side="top" className={cn("w-auto p-1", className)}>
        {children}
      </PopoverContent>
    </Popover>
  );
}

export function OptionMenu<T extends string>({ label, trigger, options, value, onPick }: {
  label: string;
  trigger: ReactNode;
  options: readonly { value: T; label: string; icon: ReactNode }[];
  value: T | null;
  onPick: (v: T) => void;
}) {
  return (
    <PopoverButton label={label} trigger={trigger} className="flex gap-0.5">
      {options.map((o) => (
        <ToolButton key={o.value} label={o.label} pressed={o.value === value} onClick={() => onPick(o.value)}>
          {o.icon}
        </ToolButton>
      ))}
    </PopoverButton>
  );
}
