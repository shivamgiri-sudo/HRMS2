import * as React from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

export type SearchableOption = {
  value: string;
  /** Primary text shown in the trigger and the list. */
  label: string;
  /** Secondary text shown alongside the label (code, cost centre, amount…). */
  hint?: string;
  /** Extra text matched during local filtering but never displayed. */
  keywords?: string;
};

type SearchableSelectProps = {
  options: SearchableOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  loading?: boolean;
  /**
   * Supply both to filter server-side. When present the component stops
   * filtering locally and simply reports what the user typed.
   */
  search?: string;
  onSearchChange?: (search: string) => void;
  id?: string;
  "aria-label"?: string;
  className?: string;
};

/**
 * Type-to-filter select. Renders as a Popover on pointer devices and as a
 * bottom Sheet on touch, where a popover anchored to a narrow trigger is
 * awkward to use one-handed.
 */
export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Type to search…",
  emptyText = "No match found.",
  disabled,
  loading,
  search,
  onSearchChange,
  id,
  "aria-label": ariaLabel,
  className,
}: SearchableSelectProps) {
  const isMobile = useIsMobile();
  const [open, setOpen] = React.useState(false);
  const [localSearch, setLocalSearch] = React.useState("");

  const serverFiltered = typeof onSearchChange === "function";
  const query = serverFiltered ? (search ?? "") : localSearch;

  const setQuery = React.useCallback(
    (next: string) => {
      if (serverFiltered) onSearchChange!(next);
      else setLocalSearch(next);
    },
    [serverFiltered, onSearchChange]
  );

  // cmdk's own scoring is disabled so that the two modes behave identically:
  // server-filtered lists arrive pre-filtered, local ones are filtered here.
  const visible = React.useMemo(() => {
    if (serverFiltered) return options;
    const term = localSearch.trim().toLowerCase();
    if (!term) return options;
    return options.filter((option) =>
      `${option.label} ${option.hint ?? ""} ${option.keywords ?? ""}`
        .toLowerCase()
        .includes(term)
    );
  }, [options, localSearch, serverFiltered]);

  const selected = options.find((option) => option.value === value);

  function choose(next: string) {
    onChange(next);
    setOpen(false);
    if (!serverFiltered) setLocalSearch("");
  }

  // Matches a native <select>'s typeahead: focus the closed trigger and start typing, no click
  // first. A single printable character (not Space/Enter/Tab/arrows, no modifier — those already
  // have their own meaning on a focused button) opens the popover and seeds the query with it;
  // CommandInput's existing autofocus-on-open (the same mechanism the click-then-type path
  // already relies on) picks up every keystroke after that with no extra wiring.
  function handleTriggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (disabled || open) return;
    if (event.key.length !== 1 || event.key === " ") return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    setOpen(true);
    setQuery(event.key);
  }

  const trigger = (
    <Button
      id={id}
      type="button"
      variant="outline"
      role="combobox"
      aria-expanded={open}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => setOpen(true)}
      onKeyDown={handleTriggerKeyDown}
      // 44px on touch, compact on desktop.
      className={cn(
        "h-11 w-full justify-between font-normal md:h-10",
        !selected && "text-muted-foreground",
        className
      )}
    >
      <span className="truncate text-left">
        {selected ? selected.label : placeholder}
      </span>
      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
    </Button>
  );

  const list = (
    <Command shouldFilter={false}>
      <CommandInput
        placeholder={searchPlaceholder}
        value={query}
        onValueChange={setQuery}
      />
      <CommandList className={cn(isMobile && "max-h-[55vh]")}>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Searching…
          </div>
        ) : (
          <>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {visible.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  onSelect={() => choose(option.value)}
                  className={cn("min-h-11 md:min-h-0", "cursor-pointer")}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4 shrink-0",
                      option.value === value ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <span className="truncate">{option.label}</span>
                  {option.hint && (
                    <span className="ml-2 shrink-0 truncate text-xs text-muted-foreground">
                      {option.hint}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </Command>
  );

  if (isMobile) {
    return (
      <>
        {trigger}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" className="h-[80vh] p-0">
            <SheetHeader className="border-b px-4 py-3 text-left">
              <SheetTitle className="text-sm">{ariaLabel ?? placeholder}</SheetTitle>
            </SheetHeader>
            {list}
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
      >
        {list}
      </PopoverContent>
    </Popover>
  );
}
