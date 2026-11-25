"use client";

import { useQuery } from "@tanstack/react-query";
import {
  BadgeCheck, Baby, Building2, Coffee, Globe, Landmark, Laptop, List, Map as MapIcon, MessageSquare, Phone, Sailboat, ShieldCheck, Smartphone,
  Sparkles, Umbrella, Wallet, Waves, type LucideIcon,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { useConfig } from "@/components/providers";
import { SiteHeader } from "@/components/site/header";
import { ListingCard, ListingCardSkeleton, Photo } from "@/components/site/listing-card";
import { SearchBar, searchQuery, useAreas, useSearchState } from "@/components/site/search-bar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";
import { get, qs } from "@/lib/api";
import { fmtRange } from "@/lib/format";
import type { ListingCard as Card } from "@/lib/types";
import { cn } from "@/lib/utils";

const ListingsMap = dynamic(() => import("@/components/site/maps"), { ssr: false, loading: () => <div className="size-full animate-pulse bg-surface" /> });

const CATEGORIES: { tag: string; label: string; icon: LucideIcon }[] = [
  { tag: "", label: "All homes", icon: Sparkles },
  { tag: "beachfront", label: "Beachfront", icon: Umbrella },
  { tag: "pool", label: "Pools", icon: Waves },
  { tag: "family", label: "Family", icon: Baby },
  { tag: "breakfast", label: "Breakfast", icon: Coffee },
  { tag: "workspace", label: "Work-friendly", icon: Laptop },
  { tag: "historic", label: "Historic", icon: Landmark },
  { tag: "creek", label: "Creek & nature", icon: Sailboat },
  { tag: "ocean-view", label: "Ocean views", icon: Building2 },
  { tag: "budget", label: "Great value", icon: Wallet },
];

export function HomeView() {
  const params = useSearchParams();
  const router = useRouter();
  const s = useSearchState();
  const tag = params.get("tag") || "";
  const [showMap, setShowMap] = React.useState(false);
  const guests = s.adults + s.children;
  const apiQuery = qs({ check_in: s.checkIn, check_out: s.checkOut, guests: guests || undefined, area: s.area, tag });
  const { data, isLoading, error } = useQuery({
    queryKey: ["listings", apiQuery],
    queryFn: () => get<{ results: Card[]; count: number; nights: number | null }>(`/api/listings${apiQuery}`),
  });
  const linkQuery = searchQuery(s);
  const listings = data?.results ?? [];
  const searching = !!(s.checkIn || s.area || guests || tag);

  return (
    <>
      <SiteHeader>
        <div className="pb-6">
          <SearchBar />
        </div>
      </SiteHeader>
      <main className="container-site">
        <div className="no-scrollbar -mx-5 flex gap-8 overflow-x-auto border-b border-line-soft px-5 pt-3 sm:mx-0 sm:px-0" role="tablist" aria-label="Categories">
          {CATEGORIES.map((c) => {
            const active = c.tag === tag;
            return (
              <button
                key={c.tag || "all"}
                role="tab"
                aria-selected={active}
                onClick={() => router.push(`/${searchQuery(s, { tag: c.tag || undefined })}`, { scroll: false })}
                className={cn(
                  "flex shrink-0 flex-col items-center gap-2 border-b-2 pb-3 text-xs font-semibold transition-colors",
                  active ? "border-ink text-ink" : "border-transparent text-ink-2 hover:border-line hover:text-ink",
                )}
              >
                <c.icon className="size-6" strokeWidth={1.5} />
                {c.label}
              </button>
            );
          })}
        </div>

        <section id="stays" className="scroll-mt-40 pt-8">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-[22px] font-bold tracking-tight">
                {isLoading ? "Finding homes…" : searching ? `${data?.count ?? 0} home${data?.count === 1 ? "" : "s"} available` : "Stay a little differently on the Kenyan coast"}
              </h1>
              <p className="mt-1 text-[15px] text-ink-2">
                {s.checkIn && s.checkOut
                  ? `${fmtRange(s.checkIn, s.checkOut)} · prices are totals with cleaning and the 2% tourism levy included`
                  : "Hand-picked apartments, cottages and family homes from Nyali to Diani — booked direct, no platform fees."}
              </p>
            </div>
          </div>

          {error ? (
            <EmptyState title="We couldn't load homes" action={<Button onClick={() => location.reload()}>Try again</Button>}>
              {(error as Error).message}
            </EmptyState>
          ) : showMap ? (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
              <div className="grid content-start gap-x-6 gap-y-10 sm:grid-cols-2">
                {listings.map((l) => (
                  <ListingCard key={l.id} listing={l} query={linkQuery} />
                ))}
              </div>
              <div className="sticky top-[180px] h-[70dvh] overflow-hidden rounded-2xl border border-line-soft max-lg:fixed max-lg:inset-0 max-lg:top-[150px] max-lg:z-30 max-lg:h-auto max-lg:rounded-none">
                <ListingsMap listings={listings} query={linkQuery} />
              </div>
            </div>
          ) : (
            <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {isLoading
                ? Array.from({ length: 8 }).map((_, i) => <ListingCardSkeleton key={i} />)
                : listings.map((l, i) => <ListingCard key={l.id} listing={l} query={linkQuery} priority={i < 4} />)}
              {!isLoading && !listings.length && (
                <div className="col-span-full">
                  <EmptyState
                    icon={<Sparkles className="size-5" />}
                    title="Nothing free for those dates"
                    action={<Button variant="soft" onClick={() => router.push("/")}>Clear search</Button>}
                  >
                    Try different dates or another neighbourhood — or text us your dates and we&apos;ll add you to the waitlist and SMS you the moment something opens up.
                  </EmptyState>
                </div>
              )}
            </div>
          )}
        </section>

        {!!listings.length && (
          <div className="pointer-events-none sticky bottom-24 z-30 mt-10 flex justify-center md:bottom-8">
            <Button onClick={() => setShowMap(!showMap)} className="pointer-events-auto h-12 rounded-full px-5 shadow-float">
              {showMap ? <List className="size-4" /> : <MapIcon className="size-4" />}
              {showMap ? "Show list" : "Show map"}
            </Button>
          </div>
        )}

        {!searching && (
          <>
            <BookYourWay />
            <Areas />
            <WhyDirect />
          </>
        )}
      </main>
    </>
  );
}

function BookYourWay() {
  const { data: config } = useConfig();
  const c = config?.channels;
  const ways = [
    { icon: Globe, title: "Website", text: "Photos, maps and instant booking with M-Pesa or card.", value: "You're here" },
    { icon: Smartphone, title: "USSD — no data", text: "Book from any phone, even a mulika mwizi. Prices, breakfast, check-out.", value: c?.ussd_code || "Dial our code" },
    { icon: MessageSquare, title: "SMS · Ask Amina", text: "Text your dates in English or Kiswahili. Wi-Fi, directions and help on demand.", value: c?.sms_number || "Text our shortcode" },
    { icon: Phone, title: "Voice · Call Amina", text: "A spoken menu in English or Kiswahili — book and pay with one call.", value: c?.voice_number || "Our hotline" },
  ];
  return (
    <section id="book-your-way" className="mt-24">
      <p className="text-sm font-bold tracking-wider text-brand-600 uppercase">One account · four doors</p>
      <h2 className="mt-2 max-w-2xl text-[32px] leading-tight font-bold tracking-tight">Book however suits you — your phone number is your account.</h2>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {ways.map((w) => (
          <div key={w.title} className="rounded-2xl border border-line-soft bg-white p-6 transition-shadow hover:shadow-card">
            <span className="grid size-11 place-items-center rounded-xl bg-brand-50 text-brand-600">
              <w.icon className="size-5" />
            </span>
            <h3 className="mt-5 text-lg font-bold">{w.title}</h3>
            <p className="mt-1.5 text-[15px] text-ink-2">{w.text}</p>
            <p className="mt-4 font-mono text-[15px] font-bold">{w.value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Areas() {
  const { data: areas } = useAreas();
  return (
    <section className="mt-24">
      <h2 className="text-[26px] font-bold tracking-tight">Explore the coast</h2>
      <div className="no-scrollbar mt-6 grid auto-cols-[78%] grid-flow-col gap-4 overflow-x-auto sm:auto-cols-[40%] lg:grid-flow-row lg:grid-cols-5 lg:overflow-visible">
        {(areas ?? []).map((a) => (
          <Link key={a.slug} href={`/?area=${a.slug}#stays`} className="group">
            <div className="relative aspect-[4/5] overflow-hidden rounded-2xl">
              <Photo src={a.photo_url} alt={a.name} className="size-full transition-transform duration-500 group-hover:scale-105" sizes="(min-width:1024px) 20vw, 80vw" />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-4 pt-16 text-white">
                <p className="text-lg font-bold">{a.name}</p>
                <p className="text-sm text-white/85">{a.summary}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function WhyDirect() {
  const items = [
    { icon: Wallet, title: "No booking fees", text: "The price you see is the total — cleaning and the 2% tourism levy included. Pay by M-Pesa, card, or 30% now and the rest later." },
    { icon: ShieldCheck, title: "Safe by design", text: "Licensed by the Tourism Regulatory Authority, 24-hour guards, and a HELP line that rings Amina's phone — day or night." },
    { icon: BadgeCheck, title: "Self check-in", text: "Your door code arrives by SMS on arrival morning and stops working at checkout. No waiting for keys." },
    { icon: Coffee, title: "A real host", text: "Swahili breakfast on your veranda, airport pickups, local tips — and answers in minutes, in your language." },
  ];
  return (
    <section className="mt-24 rounded-3xl bg-sand-50 px-6 py-12 sm:px-12">
      <h2 className="max-w-xl text-[28px] leading-tight font-bold tracking-tight">Why guests book direct with Amina</h2>
      <div className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((i) => (
          <div key={i.title}>
            <i.icon className="size-7 text-ocean-600" strokeWidth={1.6} />
            <h3 className="mt-4 font-bold">{i.title}</h3>
            <p className="mt-1.5 text-[15px] leading-relaxed text-ink-2">{i.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
