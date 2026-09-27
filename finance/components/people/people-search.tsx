"use client";

import { Loader2, Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Input } from "@/components/ui/input";

/** Search-as-you-type; the server does the query (name, mobile, contract number). */
export function PeopleSearch({ placeholder = "Search name, mobile or contract #" }: { placeholder?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get("q") ?? "");
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const push = (q: string) => {
    const next = new URLSearchParams(params);
    if (q.trim()) next.set("q", q.trim());
    else next.delete("q");
    startTransition(() => router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false }));
  };

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        type="search"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        aria-label="Search people"
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => push(e.target.value), 200);
        }}
        className="h-12 rounded-xl pr-10 pl-9 text-base"
      />
      {pending ? (
        <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-label="Searching" />
      ) : (
        value && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setValue("");
              push("");
            }}
            className="absolute top-1/2 right-1 flex size-10 -translate-y-1/2 items-center justify-center text-muted-foreground"
          >
            <X className="size-4" />
          </button>
        )
      )}
    </div>
  );
}
