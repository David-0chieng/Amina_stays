"use client";

import { useQuery } from "@tanstack/react-query";
import { MapPin, Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { GuestPicker, guestsLabel, type Guests } from "@/components/site/guest-picker";
import { Photo } from "@/components/site/listing-card";
import { RangeCalendar } from "@/components/site/range-calendar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/overlays";
import { get } from "@/lib/api";
import { fmtShort } from "@/lib/format";
import type { Area } from "@/lib/types";
import { cn } from "@/lib/utils";

export type SearchState = { area?: string; checkIn?: string; checkOut?: string } & Guests;

export function useSearchState(): SearchState {
  const p = useSearchParams();
  return {
    area: p.get("area") || undefined,
    checkIn: p.get("check_in") || undefined,
    checkOut: p.get("check_out") || undefined,
    adults: Number(p.get("adults") || 0) || (p.get("guests") ? Number(p.get("guests")) : 0),
    children: Number(p.get("children") || 0),
    infants: Number(p.get("infants") || 0),
  };
}

export function searchQuery(s: Partial<SearchState>, extra: Record<string, string | undefined> = {}) {
  const q = new URLSearchParams();
  if (s.area) q.set("area", s.area);
  if (s.checkIn && s.checkOut) {
    q.set("check_in", s.checkIn);
    q.set("check_out", s.checkOut);
  }
  if (s.adults) q.set("adults", String(s.adults));
  if (s.children) q.set("children", String(s.children));
  if (s.infants) q.set("infants", String(s.infants));
  Object.entries(extra).forEach(([k, v]) => v && q.set(k, v));
  const out = q.toString();
  return out ? `?${out}` : "";
}

export function useAreas() {
  return useQuery({ queryKey: ["areas"], queryFn: () => get<Area[]>("/api/areas"), staleTime: 10 * 60_000 });
}

type Segment = "where" | "dates" | "who" | null;

export function SearchBar() {
  const router = useRouter();
  const initial = useSearchState();
  const params = useSearchParams();
  const { data: areas } = useAreas();
  const [s, setS] = React.useState<SearchState>({ ...initial, adults: initial.adults || 0 });
  const [active, setActive] = React.useState<Segment>(null);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const paramsKey = params.toString();
  const [syncedKey, setSyncedKey] = React.useState(paramsKey);
  if (paramsKey !== syncedKey) {
    // the URL changed (back/forward, a category link): show its search in the bar
    setSyncedKey(paramsKey);
    setS({ ...initial });
  }

  const areaName = areas?.find((a) => a.slug === s.area)?.name;
  const submit = () => {
    setActive(null);
    setMobileOpen(false);
    router.push(`/${searchQuery(s, { tag: params.get("tag") || undefined })}#stays`);
  };
  const dates = s.checkIn && s.checkOut ? `${fmtShort(s.checkIn)} – ${fmtShort(s.checkOut)}` : s.checkIn ? `${fmtShort(s.checkIn)} – ?` : "";

  return (
    <>
      {/* desktop */}
      <Popover open={active !== null} onOpenChange={(o) => !o && setActive(null)}>
        <PopoverAnchor asChild>
          <div
            className={cn(
              "relative mx-auto hidden h-[66px] w-full max-w-[850px] items-center rounded-full border border-line-soft shadow-pill transition-colors md:flex",
              active ? "bg-surface" : "bg-white",
            )}
            role="search"
          >
            <SegmentButton label="Where" value={areaName ?? "Anywhere on the coast"} placeholder={!areaName} active={active === "where"} onClick={() => setActive("where")} className="flex-[1.3] pl-8" />
            <Sep hide={active === "where" || active === "dates"} />
            <SegmentButton label="Check in" value={s.checkIn ? fmtShort(s.checkIn) : "Add dates"} placeholder={!s.checkIn} active={active === "dates"} onClick={() => setActive("dates")} className="flex-1" />
            <Sep hide={active === "dates"} />
            <SegmentButton label="Check out" value={s.checkOut ? fmtShort(s.checkOut) : "Add dates"} placeholder={!s.checkOut} active={active === "dates"} onClick={() => setActive("dates")} className="flex-1" />
            <Sep hide={active === "dates" || active === "who"} />
            <div className={cn("relative flex h-full flex-[1.2] items-center rounded-full pr-2 transition-colors", active === "who" ? "bg-white shadow-card" : "hover:bg-line-soft/60")}>
              <button type="button" onClick={() => setActive("who")} className="h-full flex-1 pl-6 text-left">
                <span className="block text-xs font-bold">Who</span>
                <span className={cn("block truncate text-sm", s.adults + s.children ? "font-semibold text-ink" : "text-ink-2")}>{guestsLabel(s)}</span>
              </button>
              <Button variant="brand" onClick={submit} className={cn("h-12 rounded-full px-4 transition-all", active ? "gap-2 px-5" : "w-12 px-0")} aria-label="Search">
                <Search className="size-[18px]" strokeWidth={2.6} />
                {active && <span>Search</span>}
              </Button>
            </div>
          </div>
        </PopoverAnchor>
        <PopoverContent
          align={active === "who" ? "end" : active === "where" ? "start" : "center"}
          className={cn("rounded-[32px] p-8", active === "dates" ? "w-[min(850px,95vw)]" : active === "who" ? "w-[400px]" : "w-[520px]")}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {active === "where" && (
            <AreaGrid
              areas={areas ?? []}
              value={s.area}
              onPick={(slug) => {
                setS({ ...s, area: slug });
                setActive("dates");
              }}
            />
          )}
          {active === "dates" && (
            <>
              <RangeCalendar
                value={{ from: s.checkIn, to: s.checkOut }}
                onChange={(r) => {
                  setS({ ...s, checkIn: r.from, checkOut: r.to });
                  if (r.from && r.to) setActive("who");
                }}
              />
              <div className="mt-4 flex items-center justify-between border-t border-line-soft pt-4">
                <p className="text-sm text-ink-2">{dates || "Choose check-in, then check-out"}</p>
                <button type="button" className="text-sm font-semibold underline" onClick={() => setS({ ...s, checkIn: undefined, checkOut: undefined })}>
                  Clear dates
                </button>
              </div>
            </>
          )}
          {active === "who" && <GuestPicker value={s} onChange={(g) => setS({ ...s, ...g })} max={6} />}
        </PopoverContent>
      </Popover>

      {/* mobile */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="flex w-full items-center gap-3 rounded-full border border-line-soft bg-white px-5 py-3 text-left shadow-pill md:hidden"
      >
        <Search className="size-5" strokeWidth={2.4} />
        <span className="min-w-0">
          <span className="block text-sm font-semibold">{areaName ?? "Where to?"}</span>
          <span className="block truncate text-xs text-ink-2">{[dates || "Any week", guestsLabel(s)].join(" · ")}</span>
        </span>
      </button>
      <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogContent
          title="Find a stay"
          size="lg"
          footer={
            <div className="flex items-center justify-between">
              <button type="button" className="font-semibold underline" onClick={() => setS({ adults: 0, children: 0, infants: 0 })}>
                Clear all
              </button>
              <Button variant="brand" size="lg" onClick={submit}>
                <Search className="size-4" strokeWidth={2.6} /> Search
              </Button>
            </div>
          }
        >
          <div className="space-y-6 p-5">
            <div>
              <h3 className="mb-3 text-lg font-bold">Where to?</h3>
              <AreaGrid areas={areas ?? []} value={s.area} onPick={(slug) => setS({ ...s, area: slug })} compact />
            </div>
            <div>
              <h3 className="mb-3 text-lg font-bold">When?</h3>
              <RangeCalendar months={1} value={{ from: s.checkIn, to: s.checkOut }} onChange={(r) => setS({ ...s, checkIn: r.from, checkOut: r.to })} />
            </div>
            <div>
              <h3 className="text-lg font-bold">Who?</h3>
              <GuestPicker value={s} onChange={(g) => setS({ ...s, ...g })} max={6} />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Sep({ hide }: { hide?: boolean }) {
  return <span className={cn("h-8 w-px bg-line", hide && "invisible")} />;
}

function SegmentButton({ label, value, placeholder, active, onClick, className }: {
  label: string; value: string; placeholder?: boolean; active: boolean; onClick: () => void; className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("h-full min-w-0 rounded-full px-6 text-left transition-colors", active ? "bg-white shadow-card" : "hover:bg-line-soft/60", className)}
    >
      <span className="block text-xs font-bold">{label}</span>
      <span className={cn("block truncate text-sm", placeholder ? "text-ink-2" : "font-semibold text-ink")}>{value}</span>
    </button>
  );
}

function AreaGrid({ areas, value, onPick, compact }: { areas: Area[]; value?: string; onPick: (slug?: string) => void; compact?: boolean }) {
  return (
    <div>
      {!compact && <p className="mb-4 text-sm font-semibold">Search by neighbourhood</p>}
      <div className={cn("grid gap-3", compact ? "grid-cols-3" : "grid-cols-3")}>
        <button type="button" onClick={() => onPick(undefined)} className="group text-left">
          <div className={cn("grid aspect-square place-items-center rounded-xl border bg-surface transition", !value ? "border-ink ring-1 ring-ink" : "border-line-soft group-hover:border-ink")}>
            <MapPin className="size-7 text-ink-2" />
          </div>
          <p className="mt-2 text-sm font-medium">Anywhere</p>
        </button>
        {areas.map((a) => (
          <button key={a.slug} type="button" onClick={() => onPick(a.slug)} className="group text-left">
            <div className={cn("aspect-square overflow-hidden rounded-xl border transition", value === a.slug ? "border-ink ring-1 ring-ink" : "border-line-soft group-hover:border-ink")}>
              <Photo src={a.photo_url} alt={a.name} className="size-full" sizes="160px" />
            </div>
            <p className="mt-2 text-sm font-medium">{a.name}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
