"use client";

import "leaflet/dist/leaflet.css";

import L from "leaflet";
import Link from "next/link";
import * as React from "react";
import { Circle, MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";

import { kes } from "@/lib/format";
import { sized } from "@/lib/img";
import type { ListingCard } from "@/lib/types";

function priceIcon(label: string, active: boolean) {
  return L.divIcon({
    className: "",
    iconSize: [0, 0],
    html: `<div style="transform:translate(-50%,-50%);white-space:nowrap;font:700 13px/1 var(--font-jakarta),system-ui;padding:8px 11px;border-radius:999px;box-shadow:0 2px 8px rgba(0,0,0,.18);background:${active ? "#222" : "#fff"};color:${active ? "#fff" : "#222"};border:1px solid rgba(0,0,0,.08)">${label}</div>`,
  });
}

function Fit({ points }: { points: [number, number][] }) {
  const map = useMap();
  React.useEffect(() => {
    if (points.length) map.fitBounds(L.latLngBounds(points), { padding: [48, 48], maxZoom: 13 });
  }, [map, points]);
  return null;
}

export default function ListingsMap({ listings, query }: { listings: ListingCard[]; query: string }) {
  const [active, setActive] = React.useState<number | null>(null);
  const points = React.useMemo(
    () => listings.filter((l) => l.location).map((l) => [l.location!.lat, l.location!.lng] as [number, number]),
    [listings],
  );
  return (
    <MapContainer center={[-4.05, 39.68]} zoom={11} scrollWheelZoom className="size-full" zoomControl={false}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url={process.env.NEXT_PUBLIC_TILE_URL || "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"}
      />
      <Fit points={points} />
      {listings.map((l) =>
        l.location ? (
          <Marker
            key={l.id}
            position={[l.location.lat, l.location.lng]}
            icon={priceIcon(l.price.total ? kes(l.price.total) : kes(l.price.from_nightly), active === l.id)}
            eventHandlers={{ click: () => setActive(l.id), popupclose: () => setActive(null) }}
          >
            <Popup closeButton={false} offset={[0, -8]} className="!m-0">
              <Link href={`/stays/${l.slug}${query}`} className="block w-56 !text-ink no-underline">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={sized(l.photos[0], 480)} alt="" className="h-36 w-full rounded-lg object-cover" />
                <span className="mt-2 block text-sm font-semibold">{l.name}</span>
                <span className="block text-xs text-ink-2">{l.area.name} · {l.rating ? `★ ${l.rating.toFixed(2)}` : "New"}</span>
              </Link>
            </Popup>
          </Marker>
        ) : null,
      )}
    </MapContainer>
  );
}

export function LocationMap({ lat, lng, exact = false, height = 420 }: { lat: number; lng: number; exact?: boolean; height?: number }) {
  return (
    <div className="overflow-hidden rounded-2xl" style={{ height }}>
      <MapContainer center={[lat, lng]} zoom={exact ? 16 : 14} scrollWheelZoom={false} className="size-full">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url={process.env.NEXT_PUBLIC_TILE_URL || "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"}
        />
        {exact ? (
          <Marker position={[lat, lng]} icon={L.divIcon({ className: "", iconSize: [0, 0], html: '<div style="transform:translate(-50%,-50%);width:44px;height:44px;border-radius:999px;background:#e8553e;border:4px solid #fff;box-shadow:0 4px 12px rgba(0,0,0,.3)"></div>' })} />
        ) : (
          <Circle center={[lat, lng]} radius={450} pathOptions={{ color: "#e8553e", fillColor: "#e8553e", fillOpacity: 0.15, weight: 2 }} />
        )}
      </MapContainer>
    </div>
  );
}
