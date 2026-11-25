"use client";

import { useQuery } from "@tanstack/react-query";
import { addDays, isFriday, isSaturday, nextFriday, startOfToday } from "date-fns";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { useConfig, useHydrated } from "@/components/providers";
import { CarouselRow } from "@/components/site/carousel";
import { ExtraCard, ExtraDialog, useAddons } from "@/components/site/extras";
import { MobileTabs, SiteHeader } from "@/components/site/header";
import { HomeCard, HomeCardSkeleton, Photo } from "@/components/site/listing-card";
import { areaStyle, searchQuery, useAreas } from "@/components/site/search-bar";
import { Icon3D, type Icon3DName } from "@/components/ui/icon3d";
import { get, qs } from "@/lib/api";
import { fmtRange, iso } from "@/lib/format";
import type { Addon, ListingCard as Card } from "@/lib/types";
import { cn } from "@/lib/utils";

type Results = { results: Card[]; count: number; nights: number | null };

export function HomeView() {
  const params = useSearchParams();
  const router = useRouter();
  const legacy = params.toString();
  React.useEffect(() => {
    // old "/?area=…" links and bookmarks now live on the search page
    if (legacy) router.replace(`/s?${legacy}`);
  }, [legacy, router]);

  const hydrated = useHydrated();
  const { data, isLoading } = useQuery({ queryKey: ["listings", ""], queryFn: () => get<Results>("/api/listings") });
  const popular = [...(data?.results ?? [])].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));

  return (
    <>
      <SiteHeader mode="home" tab="homes" mobileSearch />
      <MobileTabs active="homes" />
      <main className="container-site pb-6">
        <Destinations />
        <CarouselRow title="Popular homes in Mombasa" href="/s?sort=rating">
          {isLoading ? Array.from({ length: 6 }).map((_, i) => <HomeCardSkeleton key={i} />) : popular.map((l, i) => <HomeCard key={l.id} listing={l} priority={i < 3} />)}
        </CarouselRow>
        {hydrated && <WeekendRow />}
        <ExtrasRow />
        <BookWithoutData />
        <WhyDirect />
        <div className="pointer-events-none sticky bottom-24 z-20 mt-10 flex justify-center md:bottom-6">
          <Link
            href="/help#prices"
            className="pointer-events-auto flex items-center gap-2 rounded-full bg-white py-2 pr-5 pl-3 text-sm font-medium shadow-[0_6px_20px_rgb(0_0_0/0.18)] transition-transform hover:scale-[1.03]"
          >
            <Icon3D name="label" size={26} />
            Prices include all fees
          </Link>
        </div>
      </main>
    </>
  );
}

function Destinations() {
  const { data: areas, isLoading } = useAreas();
  return (
    <CarouselRow title="Destinations for you" cols="tiles">
      {isLoading
        ? Array.from({ length: 5 }).map((_, i) => <div key={i} className="aspect-[53/50] animate-pulse rounded-2xl bg-line-soft" />)
        : (areas ?? []).map((a) => (
            <Link key={a.slug} href={`/s?area=${a.slug}`} className="group block">
              <div className="aspect-[53/50] overflow-hidden rounded-2xl bg-surface">
                <Photo src={a.photo_url} alt={a.name} className="size-full transition-transform duration-500 group-hover:scale-105" sizes="160px" />
              </div>
              <p className="mt-2 truncate text-[13px] font-medium">{a.name}</p>
              <p className="line-clamp-2 text-xs text-ink-2">{areaStyle(a).tagline}</p>
            </Link>
          ))}
    </CarouselRow>
  );
}

/** "Available this weekend": real availability and all-in totals for the coming Friday → Sunday. */
function WeekendRow() {
  const today = startOfToday();
  const start = isFriday(today) || isSaturday(today) ? today : nextFriday(today);
  const range = { checkIn: iso(start), checkOut: iso(addDays(start, 2)) };
  const query = qs({ check_in: range.checkIn, check_out: range.checkOut });
  const { data, isLoading } = useQuery({ queryKey: ["listings", query], queryFn: () => get<Results>(`/api/listings${query}`) });
  if (!isLoading && !data?.results.length) return null;
  const link = searchQuery({ ...range, adults: 0, children: 0, infants: 0 });
  return (
    <CarouselRow title="Available this weekend" subtitle={`${fmtRange(range.checkIn, range.checkOut)} · totals for 2 nights, fees included`} href={`/s${link}`}>
      {isLoading ? Array.from({ length: 6 }).map((_, i) => <HomeCardSkeleton key={i} />) : data!.results.map((l) => <HomeCard key={l.id} listing={l} query={link} />)}
    </CarouselRow>
  );
}

function ExtrasRow() {
  const { data: addons } = useAddons();
  const [open, setOpen] = React.useState<Addon | null>(null);
  if (!addons?.length) return null;
  const ordered = [...addons].sort((a, b) => Number(b.category === "experience") - Number(a.category === "experience"));
  return (
    <>
      <CarouselRow title="Make your stay special" subtitle="Experiences and services from Amina's own team" href="/services">
        {ordered.map((a) => <ExtraCard key={a.code} addon={a} onOpen={() => setOpen(a)} />)}
      </CarouselRow>
      <ExtraDialog addon={open} onClose={() => setOpen(null)} />
    </>
  );
}

const USSD_MENU = ["Book a stay", "Prices & homes", "My booking", "Breakfast", "Report problem", "Talk to Amina"];

function BookWithoutData() {
  const { data: config } = useConfig();
  const c = config?.channels;
  const ways: { icon: Icon3DName; title: string; value?: string; fallback: string; text: string }[] = [
    { icon: "mobile-phone", title: "USSD", value: c?.ussd_code, fallback: "Dial our code", text: "Any phone, no internet" },
    { icon: "speech-balloon", title: "SMS · Ask Amina", value: c?.sms_number, fallback: "Text our number", text: "English or Kiswahili" },
    { icon: "antenna", title: "Voice · Call Amina", value: c?.voice_number, fallback: "Call our line", text: "A spoken menu, 24/7" },
  ];
  return (
    <section id="book-your-way" className="scroll-mt-28 pt-16">
      <div className="grid overflow-hidden rounded-3xl bg-surface lg:grid-cols-[1.25fr_1fr]">
        <div className="p-8 md:p-12">
          <p className="text-sm font-semibold text-brand-600">No data? No problem.</p>
          <h2 className="mt-2 max-w-lg text-[28px] leading-tight font-semibold tracking-tight md:text-[32px]">Book from any phone — even without internet.</h2>
          <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-ink-2">
            Your phone number is your account on every channel. Start on USSD, pay with M-Pesa, and pick up your trip here — or never open a browser at all.
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            {ways.map((w) => (
              <div key={w.title} className="rounded-2xl bg-white p-4 shadow-[0_1px_2px_rgb(0_0_0/0.06)]">
                <Icon3D name={w.icon} size={36} />
                <p className="mt-3 text-[13px] text-ink-2">{w.title}</p>
                <p className={cn("text-[15px] font-semibold", w.value && "font-mono")}>{w.value || w.fallback}</p>
                <p className="mt-0.5 text-xs text-ink-2">{w.text}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="relative hidden items-center justify-center overflow-hidden bg-[linear-gradient(160deg,#ffe3da_0%,#cdeeec_100%)] p-10 lg:flex" aria-hidden>
          <div className="w-[230px] rounded-[38px] border-[9px] border-ink bg-[#dfe7e2] px-3 pt-10 pb-14 shadow-float">
            <div className="rounded-lg bg-white p-3 font-mono text-[12px] leading-[1.55] text-ink shadow-sm">
              <p>Karibu Amina Stays</p>
              {USSD_MENU.map((m, i) => (
                <p key={m}>{i + 1}. {m}</p>
              ))}
              <p className="text-danger">9. EMERGENCY</p>
              <div className="mt-2 h-6 rounded border border-line" />
              <div className="mt-2 flex justify-between text-[11px] font-semibold text-ocean-600">
                <span>Cancel</span>
                <span>Send</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function WhyDirect() {
  const items: { icon: Icon3DName; title: string; text: string }[] = [
    { icon: "money-bag", title: "No booking fees", text: "The price you see is the total — cleaning and the 2% tourism levy included. Pay by M-Pesa, card, or 30% now and the rest later." },
    { icon: "shield", title: "Safe by design", text: "Licensed by the Tourism Regulatory Authority, guarded 24/7, and a HELP line that rings Amina's phone — day or night." },
    { icon: "key", title: "Self check-in", text: "Your door code arrives by SMS on arrival morning and stops working at checkout. No waiting around for keys." },
    { icon: "hot-beverage", title: "A real host", text: "Swahili breakfast on your veranda, airport pickups, local tips — and answers in minutes, in your language." },
  ];
  return (
    <section className="pt-16">
      <h2 className="text-[22px] font-semibold tracking-tight md:text-[26px]">Why guests book direct with Amina</h2>
      <div className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((i) => (
          <div key={i.title}>
            <Icon3D name={i.icon} size={48} />
            <h3 className="mt-3 text-base font-semibold">{i.title}</h3>
            <p className="mt-1 text-[15px] leading-relaxed text-ink-2">{i.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
