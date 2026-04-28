"use client";

import { useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./command";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { cn } from "./utils";

export interface ValueHelpOption {
  value: string;
  label: string;
  meta?: string;
  keywords?: string[];
}

interface ValueHelpProps {
  label?: string;
  placeholder: string;
  emptyLabel: string;
  options: ValueHelpOption[];
  value: string;
  onChange: (nextValue: string) => void;
  disabled?: boolean;
  searchPlaceholder?: string;
  clearLabel?: string;
  clearDescription?: string;
  containerClassName?: string;
  triggerClassName?: string;
  popoverClassName?: string;
}

export function ValueHelp({
  label,
  placeholder,
  emptyLabel,
  options,
  value,
  onChange,
  disabled = false,
  searchPlaceholder,
  clearLabel,
  clearDescription = "Clear this filter",
  containerClassName,
  triggerClassName,
  popoverClassName,
}: ValueHelpProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);

  return (
    <div className={cn("min-w-0 w-full", containerClassName)}>
      {label ? (
        <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
          {label}
        </div>
      ) : null}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-expanded={open}
            disabled={disabled}
            className={cn(
              "flex h-11 w-full items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 text-left text-sm text-slate-700 outline-none transition hover:border-slate-300 focus-visible:border-teal-500 focus-visible:ring-2 focus-visible:ring-teal-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400",
              triggerClassName,
            )}
          >
            <span className={cn("truncate", selected ? "text-slate-900" : "text-slate-500")}>
              {selected?.label || placeholder}
            </span>
            <span className="flex items-center gap-2 text-slate-400">
              <Search size={14} />
              <ChevronDown size={16} />
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className={cn(
            "w-[min(32rem,calc(100vw-2rem))] rounded-2xl border-slate-200 p-0 shadow-[0_24px_80px_rgba(15,23,42,0.16)]",
            popoverClassName,
          )}
        >
          <Command shouldFilter>
            <CommandInput placeholder={searchPlaceholder || `Search ${label?.toLowerCase() || "options"}`} />
            <CommandList className="max-h-[320px]">
              <CommandEmpty>{emptyLabel}</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  value={`clear ${label || placeholder}`}
                  onSelect={() => {
                    onChange("");
                    setOpen(false);
                  }}
                  className="flex items-start gap-3 rounded-xl px-3 py-3"
                >
                  <Check size={16} className={cn("mt-0.5", value ? "opacity-0" : "opacity-100 text-teal-600")} />
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900">{clearLabel || placeholder}</div>
                    <div className="text-xs text-slate-500">{clearDescription}</div>
                  </div>
                </CommandItem>
                {options.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={[option.label, option.meta, ...(option.keywords || [])].filter(Boolean).join(" ")}
                    onSelect={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    className="flex items-start gap-3 rounded-xl px-3 py-3"
                  >
                    <Check size={16} className={cn("mt-0.5", value === option.value ? "opacity-100 text-teal-600" : "opacity-0")} />
                    <div className="min-w-0">
                      <div className="truncate font-medium text-slate-900">{option.label}</div>
                      {option.meta ? <div className="truncate text-xs text-slate-500">{option.meta}</div> : null}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
