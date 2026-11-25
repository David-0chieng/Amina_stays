"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ChevronDown, Grid2x2, Share, ShieldCheck, Star } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { Icon } from "@/components/icon";
import { useConfig } from "@/components/providers";
import { GuestPicker, guestsLabel, type Guests } from "@/components/site/guest-picker";
import { SiteHeader } from "@/components/site/header";
import { Photo, WishlistHeart } from "@/components/site/listing-card";
import { RangeCalendar, type Range } from "@/components/site/range-calendar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Avatar, Divider, Skeleton } from "@/components/ui/misc";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlays";
import { get, post } from "@/lib/api";
import { approx, fmtRange, fmtShort, hhmm, kes, nightsBetween } from "@/lib/format";
import type { CalendarData, ListingDetail, Quote, Review } from "@/lib/types";
import { cn, flag } from "@/lib/utils";

const LocationMap = dynamic(() => import("@/components/site/maps").then((m) => m.LocationMap), {
  ssr: false,
  loading: () => <div className="h-[420px] animate-pulse rounded-2xl bg-surface" />,
});

const CATEGORY_LABEL: Record<string, string> = {
  cleanliness: "Cleanliness", accuracy: "Accuracy", check_in: "Check-in", communication: "Communication", location: "Location", value: "Value",
};

export function ListingView({ slug }: { slug: string }) {
  const params = useSearchParams();
  const { data: l, isLoading, error } = useQuery({ queryKey: ["listing", slug], queryFn: () => get<ListingDetail>(`/api/listings/${slug}`) });
  const { data: cal } = useQuery({ queryKey: ["calendar", slug], queryFn: () => get<CalendarData>(`/api/listings/${slug}/calendar`) });
  const { data: reviews } = useQuery({ queryKey: ["reviews", slug], queryFn: () => get<Review[]>(`/api/listings/${slug}/reviews`) });
  const [range, setRange] = React.useState<Range>({ from: params.get("check_in") || undefined, to: params.get("check_out") || undefined });
  const [guests, setGuests] = React.useState<Guests>({
    adults: Number(params.get("adults") || 0) || 1,
    children: Number(params.get("children") || 0),
    infants: Number(params.get("infants") || 0),
  });
  const unavailable = React.useMemo(() => new Set(cal?.unavailable ?? []), [cal]);

  if (error) {
    return (
      <>
        <SiteHeader />
        <main className="container-narrow py-24 text-center">
          <h1 className="text-2xl font-bold">We couldn&apos;t find that home</h1>
          <p className="mt-2 text-ink-2">{(error as Error).message}</p>
          <Button asChild className="mt-6"><Link href="/">Browse all homes</Link></Button>
        </main>
      </>
    );
  }
  if (isLoading || !l) return <ListingSkeleton />;

  return (
    <>
      <SiteHeader />
      <main className="container-narrow max-w-[1280px] pb-28 md:pb-0">
        <div className="flex flex-wrap items-end justify-between gap-3 pt-6">
          <h1 className="text-[26px] leading-tight font-bold tracking-tight">{l.name}</h1>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="underline"
              onClick={async () => {
                const url = window.location.href;
                if (navigator.share) await navigator.share({ title: l.name, url }).catch(() => {});
                else {
                  await navigator.clipboard.writeText(url);
                  toast.success("Link copied");
                }
              }}
            >
              <Share className="size-4" /> Share
            </Button>
            <div className="flex items-center rounded-lg px-2 text-sm font-semibold underline hover:bg-surface">
              <WishlistHeart slug={l.slug} saved={l.wishlisted} className="[&_svg]:size-5 [&_svg]:fill-transparent [&_svg]:stroke-ink [&_svg]:drop-shadow-none" /> Save
            </div>
          </div>
        </div>

        <Gallery listing={l} />

        <div className="mt-8 grid gap-16 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0">
            <section>
              <h2 className="text-[22px] font-bold tracking-tight">{l.headline}</h2>
              <p className="mt-1 text-ink">
                {l.max_guests} guests · {l.bedrooms} bedroom{l.bedrooms !== 1 ? "s" : ""} · {l.beds} bed{l.beds !== 1 ? "s" : ""} · {l.bathrooms} bath{l.bathrooms !== 1 ? "s" : ""}
                {l.size_sqm ? ` · ${l.size_sqm} m²` : ""}
              </p>
              {l.rating && (
                <a href="#reviews" className="mt-2 inline-flex items-center gap-1.5 font-semibold">
                  <Star className="size-4 fill-ink" /> {l.rating.toFixed(2)} · <span className="underline">{l.reviews_count} reviews</span>
                </a>
              )}
            </section>

            {l.guest_favourite && <FavouriteBanner rating={l.rating ?? 0} count={l.reviews_count} />}

            <Divider className="my-8" />
            <div className="flex items-center gap-4">
              <Avatar name="Amina Mohamed" size={44} />
              <div>
                <p className="font-semibold">Hosted by {l.host.name}</p>
                <p className="text-sm text-ink-2">{l.host.superhost ? "Superhost · " : ""}{2026 - l.host.since} years hosting · replies {l.host.response_time}</p>
              </div>
            </div>
            <Divider className="my-8" />

            <div className="space-y-6">
              {l.highlights.map((h) => (
                <div key={h.title} className="flex gap-6">
                  <Icon name={h.icon} className="mt-0.5 size-6 shrink-0" />
                  <div>
                    <p className="font-semibold">{h.title}</p>
                    <p className="text-[15px] text-ink-2">{h.text}</p>
                  </div>
                </div>
              ))}
            </div>
            <Divider className="my-8" />

            <About listing={l} />
            <Divider className="my-8" />

            {!!l.sleeping.length && (
              <>
                <h2 className="text-[22px] font-bold tracking-tight">Where you&apos;ll sleep</h2>
                <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3">
                  {l.sleeping.map((s, i) => {
                    const photo = l.photos.filter((p) => p.room === "bedroom")[i];
                    return (
                      <div key={s.room}>
                        <div className="aspect-[4/3] overflow-hidden rounded-xl bg-surface">
                          {photo && <Photo src={photo.src} alt={s.room} className="size-full" sizes="300px" />}
                        </div>
                        <p className="mt-3 font-semibold">{s.room}</p>
                        <p className="text-sm text-ink-2">{s.beds}</p>
                      </div>
                    );
                  })}
                </div>
                <Divider className="my-8" />
              </>
            )}

            <Amenities listing={l} />
            <Divider className="my-8" />

            {!!l.addons.length && (
              <>
                <h2 className="text-[22px] font-bold tracking-tight">Breakfast &amp; extras</h2>
                <p className="mt-1 text-ink-2">Add them when you book, or later from your trip — by web, SMS or USSD.</p>
                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  {l.addons.filter((a) => a.price > 0 || a.code === "baby_cot").slice(0, 8).map((a) => (
                    <div key={a.code} className="flex gap-4 rounded-xl border border-line-soft p-4">
                      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-sand-100"><Icon name={a.icon} className="size-5" /></span>
                      <div className="min-w-0">
                        <p className="font-semibold">{a.name}</p>
                        <p className="text-sm text-ink-2">{a.short}</p>
                        <p className="mt-1 text-sm font-semibold">{a.price ? `${kes(a.price)} ${a.pricing_label}` : "Free"}{a.requires_approval ? " · on request" : ""}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <Divider className="my-8" />
              </>
            )}

            <section>
              <h2 className="text-[22px] font-bold tracking-tight">
                {range.from && range.to ? `${nightsBetween(range.from, range.to)} nights in ${l.area.name}` : "Select check-in date"}
              </h2>
              <p className="mt-1 text-ink-2">
                {range.from && range.to ? fmtRange(range.from, range.to) : `Minimum stay ${l.min_nights} night${l.min_nights > 1 ? "s" : ""} · prices shown per night`}
              </p>
              <div className="mt-6">
                <RangeCalendar value={range} onChange={setRange} unavailable={unavailable} prices={cal?.prices} minNights={l.min_nights} />
              </div>
              <button className="mt-4 text-sm font-semibold underline" onClick={() => setRange({})}>Clear dates</button>
            </section>
          </div>

          <aside className="hidden lg:block">
            <div className="sticky top-28">
              <BookingCard listing={l} range={range} setRange={setRange} guests={guests} setGuests={setGuests} unavailable={unavailable} prices={cal?.prices} />
            </div>
          </aside>
        </div>

        <Divider className="my-12" />
        <Reviews listing={l} reviews={reviews ?? []} />
        <Divider className="my-12" />

        <section>
          <h2 className="text-[22px] font-bold tracking-tight">Where you&apos;ll be</h2>
          <p className="mt-1 text-ink-2">{l.area.name}, Mombasa, Kenya · exact address shared once you&apos;ve booked</p>
          <div className="mt-6">{l.location && <LocationMap lat={l.location.lat} lng={l.location.lng} />}</div>
          <div className="mt-6 grid gap-8 md:grid-cols-2">
            <div>
              <h3 className="font-bold">{l.area_info.name}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{l.area_info.description}</p>
            </div>
            <div>
              <h3 className="font-bold">Getting there</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{l.area_info.getting_there}</p>
            </div>
          </div>
        </section>
        <Divider className="my-12" />

        <ThingsToKnow listing={l} />
      </main>

      <MobileReserveBar listing={l} range={range} setRange={setRange} guests={guests} setGuests={setGuests} unavailable={unavailable} prices={cal?.prices} />
    </>
  );
}

function FavouriteBanner({ rating, count }: { rating: number; count: number }) {
  return (
    <div className="mt-6 flex items-center gap-4 rounded-2xl border border-line-soft p-5">
      <div className="flex items-center gap-1 text-[17px] leading-tight font-bold">
        <span aria-hidden className="text-2xl">❦</span>
        <span className="text-center">Guest<br />favourite</span>
        <span aria-hidden className="-scale-x-100 text-2xl">❦</span>
      </div>
      <p className="flex-1 text-[15px] font-medium">One of the most loved homes on the coast, according to guests</p>
      <div className="text-center">
        <p className="text-lg font-bold">{rating.toFixed(2)}</p>
        <p className="text-xs text-ink-2">{count} reviews</p>
      </div>
    </div>
  );
}

function Gallery({ listing: l }: { listing: ListingDetail }) {
  const photos = l.photos;
  const all = (
    <DialogContent title={`${photos.length} photos of ${l.name}`} size="full">
      <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-8">
        {photos.map((p, i) => (
          <figure key={i}>
            <Photo src={p.src} alt={p.caption || `${l.name} photo ${i + 1}`} className="w-full rounded-xl" sizes="768px" />
            {p.caption && <figcaption className="mt-2 text-sm text-ink-2">{p.caption}</figcaption>}
          </figure>
        ))}
      </div>
    </DialogContent>
  );
  return (
    <Dialog>
      <div className="relative mt-6 grid h-[300px] grid-cols-4 grid-rows-2 gap-2 overflow-hidden rounded-2xl sm:h-[420px] lg:h-[460px]">
        {photos.slice(0, 5).map((p, i) => (
          <DialogTrigger key={i} asChild>
            <button className={cn("group relative overflow-hidden bg-surface", i === 0 ? "col-span-4 row-span-2 sm:col-span-2" : "hidden sm:block")}>
              <Photo src={p.src} alt={p.caption || l.name} className="size-full transition-[filter] duration-300 group-hover:brightness-90" sizes={i === 0 ? "(min-width:640px) 50vw, 100vw" : "25vw"} priority={i === 0} />
            </button>
          </DialogTrigger>
        ))}
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="absolute right-4 bottom-4 border-ink bg-white">
            <Grid2x2 className="size-4" /> Show all photos
          </Button>
        </DialogTrigger>
      </div>
      {all}
    </Dialog>
  );
}

function About({ listing: l }: { listing: ListingDetail }) {
  return (
    <section>
      <p className="text-[16px] leading-relaxed whitespace-pre-line">{l.description.split("\n\n")[0]}</p>
      <Dialog>
        <DialogTrigger asChild>
          <button className="mt-4 inline-flex items-center gap-1 font-semibold underline">Show more <ChevronDown className="size-4 -rotate-90" /></button>
        </DialogTrigger>
        <DialogContent title="About this place" size="lg">
          <div className="space-y-6 p-6 text-[15px] leading-relaxed">
            <p className="whitespace-pre-line">{l.description}</p>
            {l.the_space && <div><h3 className="mb-2 text-lg font-bold">The space</h3><p>{l.the_space}</p></div>}
            {l.guest_access && <div><h3 className="mb-2 text-lg font-bold">Guest access</h3><p>{l.guest_access}</p></div>}
            {l.neighbourhood && <div><h3 className="mb-2 text-lg font-bold">The neighbourhood</h3><p>{l.neighbourhood}</p></div>}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Amenities({ listing: l }: { listing: ListingDetail }) {
  const groups = l.amenities.reduce<Record<string, typeof l.amenities>>((acc, a) => {
    (acc[a.category] ||= []).push(a);
    return acc;
  }, {});
  return (
    <section>
      <h2 className="text-[22px] font-bold tracking-tight">What this place offers</h2>
      <div className="mt-6 grid gap-x-8 gap-y-4 sm:grid-cols-2">
        {l.amenities.slice(0, 10).map((a) => (
          <div key={a.code} className="flex items-center gap-4 text-[16px]">
            <Icon name={a.icon} className="size-6" /> {a.name}
          </div>
        ))}
      </div>
      {l.amenities.length > 10 && (
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" size="lg" className="mt-8">Show all {l.amenities.length} amenities</Button>
          </DialogTrigger>
          <DialogContent title="What this place offers" size="md">
            <div className="space-y-8 p-6">
              {Object.entries(groups).map(([cat, items]) => (
                <div key={cat}>
                  <h3 className="mb-2 text-lg font-bold capitalize">{cat.replace("_", " ")}</h3>
                  {items.map((a) => (
                    <div key={a.code} className="flex items-center gap-4 border-b border-line-soft py-4">
                      <Icon name={a.icon} className="size-6" /> {a.name}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}

function useQuote(slug: string, range: Range, guests: Guests) {
  const ready = !!(range.from && range.to);
  return useQuery({
    queryKey: ["quote", slug, range.from, range.to, guests.adults, guests.children],
    queryFn: () => post<Quote>(`/api/listings/${slug}/quote`, { check_in: range.from, check_out: range.to, adults: guests.adults, children: guests.children }),
    enabled: ready,
  });
}

type CardProps = {
  listing: ListingDetail; range: Range; setRange: (r: Range) => void; guests: Guests; setGuests: (g: Guests) => void;
  unavailable: Set<string>; prices?: Record<string, number>;
};

function BookingCard({ listing: l, range, setRange, guests, setGuests, unavailable, prices }: CardProps) {
  const router = useRouter();
  const { data: config } = useConfig();
  const { data: q, isFetching } = useQuote(l.slug, range, guests);
  const [datesOpen, setDatesOpen] = React.useState(false);
  const ready = !!(range.from && range.to);
  const reserve = () => {
    if (!ready) return setDatesOpen(true);
    const s = new URLSearchParams({ check_in: range.from!, check_out: range.to!, adults: String(guests.adults) });
    if (guests.children) s.set("children", String(guests.children));
    if (guests.infants) s.set("infants", String(guests.infants));
    router.push(`/book/${l.slug}?${s}`);
  };
  return (
    <div className="rounded-2xl border border-line-soft bg-white p-6 shadow-card">
      <p className="text-[22px]">
        {q ? (
          <>
            <span className="font-bold">{kes(q.total)}</span> <span className="text-base text-ink-2">for {q.nights} night{q.nights !== 1 ? "s" : ""}</span>
          </>
        ) : (
          <>
            <span className="font-bold">{kes(l.price.from_nightly)}</span> <span className="text-base text-ink-2">night · from</span>
          </>
        )}
      </p>
      <div className="mt-5 overflow-hidden rounded-xl border border-ink-3">
        <Popover open={datesOpen} onOpenChange={setDatesOpen}>
          <PopoverTrigger asChild>
            <button className="grid w-full grid-cols-2 text-left">
              <span className="border-r border-ink-3 px-3 py-2.5">
                <span className="block text-[10px] font-bold uppercase">Check-in</span>
                <span className={cn("text-sm", !range.from && "text-ink-2")}>{range.from ? fmtShort(range.from) : "Add date"}</span>
              </span>
              <span className="px-3 py-2.5">
                <span className="block text-[10px] font-bold uppercase">Checkout</span>
                <span className={cn("text-sm", !range.to && "text-ink-2")}>{range.to ? fmtShort(range.to) : "Add date"}</span>
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[min(760px,95vw)] rounded-3xl p-7">
            <RangeCalendar value={range} onChange={(r) => { setRange(r); if (r.from && r.to) setDatesOpen(false); }} unavailable={unavailable} prices={prices} minNights={l.min_nights} />
            <div className="mt-4 flex justify-end gap-3 border-t border-line-soft pt-4">
              <Button variant="ghost" size="sm" className="underline" onClick={() => setRange({})}>Clear dates</Button>
              <Button size="sm" onClick={() => setDatesOpen(false)}>Close</Button>
            </div>
          </PopoverContent>
        </Popover>
        <Popover>
          <PopoverTrigger asChild>
            <button className="flex w-full items-center justify-between border-t border-ink-3 px-3 py-2.5 text-left">
              <span>
                <span className="block text-[10px] font-bold uppercase">Guests</span>
                <span className="text-sm">{guestsLabel(guests)}</span>
              </span>
              <ChevronDown className="size-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[340px]">
            <GuestPicker value={guests} onChange={setGuests} max={l.max_guests} />
          </PopoverContent>
        </Popover>
      </div>
      <Button variant="brand" size="xl" className="mt-4 w-full" onClick={reserve} loading={isFetching && ready} disabled={ready && q?.available === false}>
        {ready ? "Reserve" : "Check availability"}
      </Button>
      {q?.problems?.length ? <p className="mt-3 text-center text-sm text-danger">{q.problems[0]}</p> : <p className="mt-3 text-center text-sm text-ink-2">Pay by M-Pesa or card · {l.deposit_percent}% deposit option</p>}
      {q && (
        <div className="mt-5 space-y-3 text-[15px]">
          {q.lines.map((line) => (
            <div key={line.label} className={cn("flex justify-between gap-4", line.amount < 0 && "text-success")}>
              <span className="underline decoration-line">{line.label}</span>
              <span>{line.amount < 0 ? `−${kes(-line.amount)}` : kes(line.amount)}</span>
            </div>
          ))}
          <Divider />
          <div className="flex justify-between font-bold">
            <span>Total</span>
            <span>{kes(q.total)}</span>
          </div>
          {config && <p className="text-right text-xs text-ink-2">{approx(q.total, config.currencies, "USD")} · {approx(q.total, config.currencies, "EUR")} · {approx(q.total, config.currencies, "GBP")}</p>}
        </div>
      )}
      {config?.channels.ussd_code && (
        <p className="mt-5 rounded-xl bg-surface p-3 text-center text-[13px] text-ink-2">
          No data? Dial <b className="text-ink">{config.channels.ussd_code}</b> to book this home from any phone.
        </p>
      )}
    </div>
  );
}

function MobileReserveBar(props: CardProps) {
  const { listing: l, range } = props;
  const { data: q } = useQuote(l.slug, range, props.guests);
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-4 border-t border-line-soft bg-white px-5 py-3 pb-[max(12px,env(safe-area-inset-bottom))] lg:hidden">
      <div>
        <p className="font-bold">{q ? kes(q.total) : kes(l.price.from_nightly)}<span className="font-normal text-ink-2">{q ? " total" : " night"}</span></p>
        <Dialog>
          <DialogTrigger asChild>
            <button className="flex items-center gap-1 text-sm font-semibold underline">
              <CalendarDays className="size-3.5" /> {range.from && range.to ? fmtRange(range.from, range.to) : "Add dates"}
            </button>
          </DialogTrigger>
          <DialogContent title="Your stay" size="md">
            <div className="p-5">
              <BookingCard {...props} />
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="brand" size="lg">Reserve</Button>
        </DialogTrigger>
        <DialogContent title="Reserve" size="md">
          <div className="p-5">
            <BookingCard {...props} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Reviews({ listing: l, reviews }: { listing: ListingDetail; reviews: Review[] }) {
  const cats = l.reviews_summary.categories;
  if (!l.reviews_count) {
    return (
      <section id="reviews">
        <h2 className="text-[22px] font-bold tracking-tight">No reviews yet</h2>
        <p className="mt-1 text-ink-2">Be one of the first guests — reviews come only from verified stays.</p>
      </section>
    );
  }
  return (
    <section id="reviews" className="scroll-mt-24">
      <h2 className="flex items-center gap-2 text-[22px] font-bold tracking-tight">
        <Star className="size-5 fill-ink" /> {l.rating?.toFixed(2)} · {l.reviews_count} reviews
      </h2>
      <div className="mt-6 grid grid-cols-2 gap-x-12 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
        {Object.entries(CATEGORY_LABEL).map(([k, label]) => (
          <div key={k} className="lg:border-r lg:border-line-soft lg:pr-6 lg:last:border-0">
            <p className="text-sm font-semibold">{label}</p>
            <p className="text-lg font-bold">{cats[k]?.toFixed(1) ?? "—"}</p>
          </div>
        ))}
      </div>
      <div className="mt-10 grid gap-x-16 gap-y-10 md:grid-cols-2">
        {reviews.slice(0, 6).map((r) => <ReviewCard key={r.id} review={r} />)}
      </div>
      {reviews.length > 6 && (
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" size="lg" className="mt-10">Show all {reviews.length} reviews</Button>
          </DialogTrigger>
          <DialogContent title={`${reviews.length} reviews`} size="lg">
            <div className="space-y-8 p-6">{reviews.map((r) => <ReviewCard key={r.id} review={r} />)}</div>
          </DialogContent>
        </Dialog>
      )}
      <p className="mt-8 flex items-center gap-2 text-sm text-ink-2">
        <ShieldCheck className="size-4 text-ocean-600" /> Only guests who completed a stay can leave a review.
      </p>
    </section>
  );
}

function ReviewCard({ review: r }: { review: Review }) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <Avatar name={r.guest} size={44} />
        <div>
          <p className="font-semibold">{r.guest} {flag(r.country)}</p>
          <p className="text-sm text-ink-2">{new Date(r.date).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-1 text-xs">
        {Array.from({ length: 5 }).map((_, i) => <Star key={i} className={cn("size-3", i < r.rating ? "fill-ink" : "fill-line stroke-line")} />)}
      </div>
      <p className="mt-2 text-[15px] leading-relaxed">{r.comment}</p>
      {r.host_response && <p className="mt-3 border-l-2 border-line pl-3 text-sm text-ink-2"><b className="text-ink">Response from Amina:</b> {r.host_response}</p>}
    </div>
  );
}

function ThingsToKnow({ listing: l }: { listing: ListingDetail }) {
  return (
    <section id="cancellations">
      <h2 className="text-[22px] font-bold tracking-tight">Things to know</h2>
      <div className="mt-6 grid gap-10 md:grid-cols-3">
        <div>
          <h3 className="font-bold">House rules</h3>
          <ul className="mt-3 space-y-2.5 text-[15px] text-ink">
            <li>Check-in after {hhmm(l.checkin_time)}</li>
            <li>Checkout before {hhmm(l.checkout_time)}</li>
            <li>{l.max_guests} guests maximum</li>
            {l.house_rules.slice(2).map((r) => <li key={r}>{r}</li>)}
            <li>Pets {l.pets_allowed ? "allowed" : "not allowed"} · Quiet hours {l.quiet_hours}</li>
          </ul>
        </div>
        <div>
          <h3 className="font-bold">Safety &amp; property</h3>
          <ul className="mt-3 space-y-2.5 text-[15px] text-ink">
            {l.safety_features.map((s) => <li key={s}>{s}</li>)}
            <li>Text HELP any time — it rings Amina&apos;s phone</li>
          </ul>
        </div>
        <div>
          <h3 className="font-bold">Cancellation policy · {l.cancellation.label}</h3>
          <p className="mt-3 text-[15px]">{l.cancellation.text}</p>
          <p className="mt-3 text-[15px] text-ink-2">Check-in: {l.access_method}{l.self_checkin ? " — self check-in with a door code sent by SMS on arrival morning." : "."}</p>
          {l.tra_licence && (
            <p className="mt-4 text-sm text-ink-2">
              Licensed by the Tourism Regulatory Authority · <b className="text-ink">{l.tra_licence}</b> ·{" "}
              <a className="underline" href="https://verify.tra.go.ke/" target="_blank" rel="noreferrer">verify</a>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function ListingSkeleton() {
  return (
    <>
      <SiteHeader />
      <main className="container-narrow max-w-[1280px] pt-6">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="mt-6 h-[420px] w-full rounded-2xl" />
        <div className="mt-8 grid gap-16 lg:grid-cols-[1fr_380px]">
          <div className="space-y-4">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-32 w-full" />
          </div>
          <Skeleton className="hidden h-80 rounded-2xl lg:block" />
        </div>
      </main>
    </>
  );
}
