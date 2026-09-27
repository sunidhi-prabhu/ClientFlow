"use client";

import { Loader2, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Search box state for URL-driven lists. Typing commits after a short pause;
 * the value follows URL changes made elsewhere ("Clear filters", back/forward)
 * without overwriting what the user is typing (the URL holds the trimmed value).
 */
export function useListSearch(urlValue: string, commit: (value: string) => void) {
  const [value, setValue] = useState(urlValue);
  const [lastUrlValue, setLastUrlValue] = useState(urlValue);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  if (urlValue !== lastUrlValue) {
    setLastUrlValue(urlValue);
    if (urlValue !== value.trim()) setValue(urlValue);
  }
  useEffect(() => () => clearTimeout(timer.current), []);

  return {
    value,
    change(next: string) {
      setValue(next);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => commit(next), SEARCH_DEBOUNCE_MS);
    },
    /** Cancel a pending debounced commit (call before committing directly). */
    cancel() {
      clearTimeout(timer.current);
    },
  };
}

export function ListSearchInput({
  label,
  placeholder,
  value,
  onChange,
  pending,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  pending: boolean;
}) {
  return (
    <div className="relative flex-1">
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        type="search"
        name="q"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        maxLength={100}
        onChange={(event) => onChange(event.target.value)}
        className="pl-8"
      />
      {pending && (
        <Loader2
          className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
          aria-label="Updating results"
        />
      )}
    </div>
  );
}
