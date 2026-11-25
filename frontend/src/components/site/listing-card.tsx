"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Heart } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";

import { useAuthDialog, useMe } from "@/components/providers";
import { del, post } from "@/lib/api";
import { kes } from "@/lib/format";
import { sized, srcSet } from "@/lib/img";
import type { ListingCard as Card } from "@/lib/types";
import { cn } from "@/lib/utils";

export function Photo({ src, alt, className, sizes = "(min-width: 1280px) 20vw, (min-width: 768px) 33vw, 100vw", priority }: {
  src: string; alt: string; className?: string; sizes?: string; priority?: boolean;
}) {
  const [failed, setFailed] = React.useState(false);
  if (failed || !src) return <div className={cn("bg-gradient-to-br from-ocean-100 via-sand-100 to-brand-100", className)} aria-label={alt} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={sized(src, 960)}
      srcSet={srcSet(src)}
      sizes={sizes}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      onError={() => setFailed(true)}
      className={cn("object-cover", className)}
    />
  );
}

export function WishlistHeart({ slug, saved, className }: { slug: string; saved: boolean; className?: string }) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { requireLogin } = useAuthDialog();
  const [on, setOn] = React.useState(saved);
  const [prevSaved, setPrevSaved] = React.useState(saved);
  if (saved !== prevSaved) {
    setPrevSaved(saved);
    setOn(saved);
  }
  const m = useMutation({
    mutationFn: (next: boolean) => (next ? post("/api/me/wishlist", { slug }) : del(`/api/me/wishlist/${slug}`)),
    onSuccess: (_, next) => {
      toast.success(next ? "Saved to your wishlist" : "Removed from wishlist");
      qc.invalidateQueries({ queryKey: ["wishlist"] });
    },
    onError: (e, next) => {
      setOn(!next);
      toast.error((e as Error).message);
    },
  });
  return (
    <button
      type="button"
      aria-label={on ? "Remove from wishlist" : "Save to wishlist"}
      aria-pressed={on}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!me?.authenticated) return requireLogin("Log in to save homes you love");
        setOn(!on);
        m.mutate(!on);
      }}
      className={cn("grid size-9 place-items-center transition-transform active:scale-90", className)}
    >
      <Heart className={cn("size-6 drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]", on ? "fill-brand-500 stroke-white" : "fill-black/40 stroke-white")} strokeWidth={2} />
    </button>
  );
}

export function ListingCard({ listing, query = "", priority }: { listing: Card; query?: string; priority?: boolean }) {
  const [index, setIndex] = React.useState(0);
  const photos = listing.photos.length ? listing.photos : [""];
  const go = (e: React.MouseEvent, d: number) => {
    e.preventDefault();
    e.stopPropagation();
    setIndex((i) => (i + d + photos.length) % photos.length);
  };
  const p = listing.price;
  return (
    <Link href={`/stays/${listing.slug}${query}`} className="group block outline-none" aria-label={`${listing.name}, ${listing.area.name}`}>
      <div className="relative aspect-[20/19] overflow-hidden rounded-xl bg-surface">
        <div className="flex h-full transition-transform duration-300 ease-out" style={{ transform: `translateX(-${index * 100}%)` }}>
          {photos.map((src, i) => (
            <Photo key={i} src={src} alt={`${listing.name} photo ${i + 1}`} className="h-full w-full shrink-0" priority={priority && i === 0} />
          ))}
        </div>
        {listing.guest_favourite && (
          <span className="absolute top-3 left-3 rounded-full bg-white px-3 py-1 text-[13px] font-semibold shadow-soft">Guest favourite</span>
        )}
        <WishlistHeart slug={listing.slug} saved={listing.wishlisted} className="absolute top-2 right-2" />
        {photos.length > 1 && (
          <>
            <button
              type="button"
              aria-label="Previous photo"
              onClick={(e) => go(e, -1)}
              className={cn("absolute top-1/2 left-3 hidden size-8 -translate-y-1/2 place-items-center rounded-full bg-white/90 opacity-0 shadow-soft transition-opacity group-hover:opacity-100 hover:scale-105 md:grid", index === 0 && "md:hidden")}
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              aria-label="Next photo"
              onClick={(e) => go(e, 1)}
              className={cn("absolute top-1/2 right-3 hidden size-8 -translate-y-1/2 place-items-center rounded-full bg-white/90 opacity-0 shadow-soft transition-opacity group-hover:opacity-100 hover:scale-105 md:grid", index === photos.length - 1 && "md:hidden")}
            >
              <ChevronRight className="size-4" />
            </button>
            <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5">
              {photos.slice(0, 5).map((_, i) => (
                <span key={i} className={cn("size-1.5 rounded-full bg-white transition-opacity", i === Math.min(index, 4) ? "opacity-100" : "opacity-60")} />
              ))}
            </div>
          </>
        )}
      </div>
      <div className="mt-3 text-[15px] leading-snug">
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate font-semibold">{listing.headline}</h3>
          {listing.rating ? (
            <span className="flex shrink-0 items-center gap-1">
              <svg viewBox="0 0 32 32" className="size-3" fill="currentColor" aria-hidden><path d="M15.1 1.58l-4.13 8.88-9.86 1.27a1 1 0 0 0-.54 1.74l7.3 6.57-1.97 9.85a1 1 0 0 0 1.48 1.06l8.62-5 8.63 5a1 1 0 0 0 1.48-1.06l-1.97-9.85 7.3-6.57a1 1 0 0 0-.55-1.73l-9.86-1.28-4.12-8.88a1 1 0 0 0-1.82 0z" /></svg>
              {listing.rating.toFixed(2)} <span className="text-ink-2">({listing.reviews_count})</span>
            </span>
          ) : (
            <span className="shrink-0 text-ink-2">New</span>
          )}
        </div>
        <p className="truncate text-ink-2">{listing.name}</p>
        <p className="text-ink-2">
          {listing.bedrooms} bedroom{listing.bedrooms !== 1 ? "s" : ""} · {listing.beds} bed{listing.beds !== 1 ? "s" : ""} · sleeps {listing.max_guests}
        </p>
        <p className="mt-1.5">
          {p.total ? (
            <>
              <span className="font-semibold underline decoration-1 underline-offset-2">{kes(p.total)}</span>
              <span className="text-ink-2"> total for {p.nights} night{p.nights !== 1 ? "s" : ""}</span>
            </>
          ) : (
            <>
              <span className="text-ink-2">From </span>
              <span className="font-semibold">{kes(p.from_nightly)}</span>
              <span className="text-ink-2"> night</span>
            </>
          )}
        </p>
      </div>
    </Link>
  );
}

export function ListingCardSkeleton() {
  return (
    <div>
      <div className="aspect-[20/19] animate-pulse rounded-xl bg-line-soft" />
      <div className="mt-3 h-4 w-2/3 animate-pulse rounded bg-line-soft" />
      <div className="mt-2 h-4 w-1/2 animate-pulse rounded bg-line-soft" />
      <div className="mt-2 h-4 w-1/3 animate-pulse rounded bg-line-soft" />
    </div>
  );
}
