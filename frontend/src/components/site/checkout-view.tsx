"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, CreditCard, Lock, ShieldCheck, Smartphone, Star } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { Icon } from "@/components/icon";
import { useConfig, useMe } from "@/components/providers";
import { GuestPicker, guestsLabel, type Guests } from "@/components/site/guest-picker";
import { SiteHeader } from "@/components/site/header";
import { PhoneLogin } from "@/components/site/phone-login";
import { Photo } from "@/components/site/listing-card";
import { RangeCalendar, type Range } from "@/components/site/range-calendar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Divider, Skeleton, Spinner } from "@/components/ui/misc";
import { Switch } from "@/components/ui/overlays";
import { get, post } from "@/lib/api";
import { approx, fmtDate, fmtRange, fmtTime, kes } from "@/lib/format";
import type { Addon, CalendarData, ListingDetail, PaymentResult, Quote, Trip } from "@/lib/types";
import { COUNTRIES, cn } from "@/lib/utils";

type Extra = { on: boolean; details: Record<string, string>; quantity?: number };
const STYLE_LABEL: Record<string, string> = { swahili: "Swahili — mahamri, chai, mbaazi, fruit", continental: "Continental", english: "Full English", vegetarian: "Vegetarian / vegan" };

export function CheckoutView({ slug }: { slug: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const { data: me } = useMe();
  const { data: config } = useConfig();
  const { data: l } = useQuery({ queryKey: ["listing", slug], queryFn: () => get<ListingDetail>(`/api/listings/${slug}`) });
  const { data: cal } = useQuery({ queryKey: ["calendar", slug], queryFn: () => get<CalendarData>(`/api/listings/${slug}/calendar`) });
  const [range, setRange] = React.useState<Range>({ from: params.get("check_in") || undefined, to: params.get("check_out") || undefined });
  const [guests, setGuests] = React.useState<Guests>({ adults: Number(params.get("adults") || 1), children: Number(params.get("children") || 0), infants: Number(params.get("infants") || 0) });
  const [plan, setPlan] = React.useState<"full" | "deposit">("full");
  const [extras, setExtras] = React.useState<Record<string, Extra>>({ breakfast: { on: false, details: { style: "swahili", time: "08:00", dietary: "" } } });
  const [form, setForm] = React.useState({ name: "", email: "", lang: "en", nationality: "", id_type: "", id_number: "", consent: false, eta: "", mode: "", plate: "", requests: "", marketing: false });
  const [method, setMethod] = React.useState<"mpesa" | "card">("mpesa");
  const [submitting, setSubmitting] = React.useState(false);
  const [result, setResult] = React.useState<{ booking: Trip; payment: PaymentResult } | null>(null);

  // Prefill from the account once it loads (or when someone logs in on this page).
  const [prefilledFor, setPrefilledFor] = React.useState<number | null>(null);
  if (me?.authenticated && me.id !== undefined && me.id !== prefilledFor) {
    setPrefilledFor(me.id);
    setForm((f) => ({ ...f, name: f.name || me.name || "", email: f.email || me.email || "", lang: me.lang || f.lang, nationality: f.nationality || me.nationality || "" }));
    setMethod(me.phone?.startsWith("+254") ? "mpesa" : "card");
  }

  const addonList = Object.entries(extras).filter(([, e]) => e.on).map(([code, e]) => ({ code, quantity: e.quantity, details: e.details }));
  const ready = !!(range.from && range.to);
  const { data: q, isFetching } = useQuery({
    queryKey: ["quote", slug, range.from, range.to, guests.adults, guests.children, plan, JSON.stringify(addonList.map((a) => [a.code, a.quantity]))],
    queryFn: () => post<Quote>(`/api/listings/${slug}/quote`, { check_in: range.from, check_out: range.to, adults: guests.adults, children: guests.children, addons: addonList, payment_plan: plan }),
    enabled: ready,
    placeholderData: (prev) => prev,
  });

  if (result) return <PaymentFlow result={result} listing={l} />;
  if (!l) return <CheckoutSkeleton />;

  const kenyan = !!me?.phone?.startsWith("+254");
  const dueNow = q ? (plan === "deposit" && q.deposit_available ? q.deposit : q.total) : 0;

  async function submit() {
    if (!ready || !q) return toast.error("Choose your dates first.");
    if (q.available === false) return toast.error(q.problems?.[0] ?? "Those dates aren't available.");
    if (form.id_number && !form.consent) return toast.error("Please tick the consent box to store your ID for the guest register.");
    setSubmitting(true);
    try {
      const r = await post<{ booking: Trip; payment: PaymentResult }>("/api/bookings", {
        listing: slug, check_in: range.from, check_out: range.to, adults: guests.adults, children: guests.children, infants: guests.infants,
        addons: addonList, payment_plan: plan, payment_method: method, arrival_eta: form.eta, arrival_mode: form.mode, vehicle_plate: form.plate,
        special_requests: form.requests, name: form.name, email: form.email, lang: form.lang, marketing_opt_in: form.marketing,
        identity: form.id_number ? { id_type: form.id_type, id_number: form.id_number, nationality: form.nationality, consent: form.consent } : undefined,
      });
      setResult(r);
      window.scrollTo({ top: 0 });
      if (r.payment.method === "card" && r.payment.checkout_url && !r.payment.error) window.location.href = r.payment.checkout_url;
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <SiteHeader />
      <main className="container-narrow max-w-[1160px] pt-8 pb-24">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.back()} aria-label="Back"><ArrowLeft className="size-5" /></Button>
          <h1 className="text-[28px] font-bold tracking-tight sm:text-[32px]">Confirm and pay</h1>
        </div>
        <div className="mt-8 grid gap-12 lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-20">
          <div className="min-w-0 space-y-10">
            {!me?.authenticated && (
              <section className="rounded-2xl border border-line-soft p-6">
                <PhoneLogin title="Log in or sign up to book" subtitle="Your booking, receipts and door code go to this number." cta="Continue" />
              </section>
            )}

            <section>
              <h2 className="text-[22px] font-bold tracking-tight">Your trip</h2>
              <div className="mt-5 flex items-start justify-between gap-4">
                <div>
                  <p className="font-semibold">Dates</p>
                  <p className="text-ink-2">{ready ? fmtRange(range.from, range.to) : "Choose dates"}</p>
                </div>
                <Dialog>
                  <DialogTrigger asChild><button className="font-semibold underline">Edit</button></DialogTrigger>
                  <DialogContent title="Change dates" size="lg">
                    <div className="p-6">
                      <RangeCalendar value={range} onChange={setRange} unavailable={new Set(cal?.unavailable ?? [])} prices={cal?.prices} minNights={l.min_nights} />
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
              <div className="mt-5 flex items-start justify-between gap-4">
                <div>
                  <p className="font-semibold">Guests</p>
                  <p className="text-ink-2">{guestsLabel(guests)}</p>
                </div>
                <Dialog>
                  <DialogTrigger asChild><button className="font-semibold underline">Edit</button></DialogTrigger>
                  <DialogContent title="Guests" size="sm">
                    <div className="px-6 pb-4"><GuestPicker value={guests} onChange={setGuests} max={l.max_guests} /></div>
                  </DialogContent>
                </Dialog>
              </div>
              {q?.problems?.length ? <p className="mt-4 rounded-xl bg-danger-50 p-3 text-sm text-danger">{q.problems.join(" ")}</p> : null}
            </section>
            <Divider />

            <section>
              <h2 className="text-[22px] font-bold tracking-tight">Choose when to pay</h2>
              <div className="mt-5 overflow-hidden rounded-2xl border border-line">
                <PlanOption checked={plan === "full"} onSelect={() => setPlan("full")} title={`Pay ${q ? kes(q.total) : "in full"} now`} text="One payment and you're done." />
                <PlanOption
                  checked={plan === "deposit"}
                  disabled={!!q && !q.deposit_available}
                  onSelect={() => setPlan("deposit")}
                  title={`Pay part now, part later${q ? ` — ${kes(q.deposit)} today` : ""}`}
                  text={q?.deposit_available ? `${l.deposit_percent}% today and the rest (${kes(q.total - q.deposit)}) on ${fmtDate(q.balance_due_date)} — we'll send an M-Pesa prompt or a pay link.` : "Available for stays booked more than a day ahead."}
                />
              </div>
            </section>
            <Divider />

            <Extras listing={l} extras={extras} setExtras={setExtras} guests={guests.adults + guests.children} />
            <Divider />

            <section className="space-y-5">
              <h2 className="text-[22px] font-bold tracking-tight">About you</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Full name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" placeholder="As on your ID or passport" /></Field>
                <Field label="Email (optional)" hint="For receipts. Everything else comes by SMS."><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" /></Field>
                <Field label="Messages in" hint="Booking updates, directions and your door code.">
                  <Select value={form.lang} onChange={(e) => setForm({ ...form, lang: e.target.value })}>
                    <option value="en">English</option><option value="sw">Kiswahili</option><option value="it">Italiano</option><option value="de">Deutsch</option><option value="fr">Français</option>
                  </Select>
                </Field>
                <Field label="Nationality">
                  <Select value={form.nationality} onChange={(e) => setForm({ ...form, nationality: e.target.value })}>
                    <option value="">Select…</option>
                    {COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
                  </Select>
                </Field>
              </div>
            </section>

            <section className="rounded-2xl border border-line-soft bg-sand-50 p-6">
              <h3 className="flex items-center gap-2 text-lg font-bold"><ShieldCheck className="size-5 text-ocean-600" /> Guest register</h3>
              {me?.identity?.last4 ? (
                <p className="mt-1 flex flex-wrap items-center gap-2 text-[15px] text-ink-2">
                  <CheckCircle2 className="size-4 text-success" />
                  <span><b className="text-ink">{me.identity.type_label} {me.identity.last4}</b> is on file (stored encrypted) — nothing to do. Add other adult guests from your trip page.</span>
                </p>
              ) : (
                <>
                  <p className="mt-1 text-[15px] text-ink-2">
                    Kenya&apos;s Tourism Enterprises Regulations require every host to keep a guest register. Add it now and your door code is released automatically on arrival morning — or add it later from your trip page or by SMS (&ldquo;ID 12345678&rdquo;).
                  </p>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <Field label="Document">
                      <Select value={form.id_type} onChange={(e) => setForm({ ...form, id_type: e.target.value })}>
                        <option value="">Choose…</option><option value="passport">Passport</option><option value="national_id">Kenyan National ID</option><option value="alien_id">Alien / Foreigner ID</option><option value="driving_licence">Driving licence</option>
                      </Select>
                    </Field>
                    <Field label="Number"><Input value={form.id_number} onChange={(e) => setForm({ ...form, id_number: e.target.value })} placeholder="e.g. 28123456 or P1234567" /></Field>
                  </div>
                  <label className="mt-4 flex items-start gap-3 text-sm">
                    <input type="checkbox" className="mt-0.5 size-4 accent-ink" checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })} />
                    <span>I agree that Amina Stays stores my ID number <b>encrypted</b>, only for the guest register required by law, and erases it after the 5-year retention period (Data Protection Act 2019).</span>
                  </label>
                </>
              )}
            </section>

            <section className="space-y-5">
              <h2 className="text-[22px] font-bold tracking-tight">Your arrival</h2>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Arrival time"><Input type="time" value={form.eta} onChange={(e) => setForm({ ...form, eta: e.target.value })} /></Field>
                <Field label="Arriving by">
                  <Select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
                    <option value="">Choose…</option><option value="flight">Flight (Moi Airport)</option><option value="sgr">SGR train</option><option value="car">Car / taxi</option><option value="bus">Bus</option><option value="local">Already in Mombasa</option>
                  </Select>
                </Field>
                <Field label="Car plate (optional)" hint="For the gate log"><Input value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value.toUpperCase() })} placeholder="KDA 123A" /></Field>
              </div>
              <Field label="Message for Amina (optional)"><Textarea value={form.requests} onChange={(e) => setForm({ ...form, requests: e.target.value })} placeholder="Celebrating something? Travelling with a baby? Let us know." /></Field>
            </section>
            <Divider />

            <section>
              <h2 className="text-[22px] font-bold tracking-tight">Pay with</h2>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <MethodOption
                  checked={method === "mpesa"} disabled={!!me?.authenticated && !kenyan} onSelect={() => setMethod("mpesa")}
                  icon={<Smartphone className="size-5" />} title="M-Pesa" text={kenyan ? `A prompt will appear on ${me?.phone}` : "Needs a Kenyan (+254) number"}
                />
                <MethodOption checked={method === "card"} onSelect={() => setMethod("card")} icon={<CreditCard className="size-5" />} title="Card" text="Visa, Mastercard — secure hosted checkout" />
              </div>
              {config?.payments.simulated && <p className="mt-3 text-[13px] text-ink-2">Demo mode: payments are simulated — no money moves.</p>}
            </section>
            <Divider />

            <section className="space-y-4 text-[15px]">
              <div>
                <h3 className="font-bold">Cancellation policy</h3>
                <p className="mt-1 text-ink-2">{l.cancellation.text}</p>
              </div>
              <div>
                <h3 className="font-bold">Ground rules</h3>
                <p className="mt-1 text-ink-2">Follow the house rules, no parties, register every adult guest, and treat Amina&apos;s home like your own.</p>
              </div>
              <p className="flex gap-2 rounded-xl bg-ocean-50 p-4 text-sm text-ocean-700">
                <Lock className="mt-0.5 size-4 shrink-0" /> We only ever take payment through the official M-Pesa prompt or our secure card page. We will never ask you to send money to a personal number.
              </p>
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" className="mt-0.5 size-4 accent-ink" checked={form.marketing} onChange={(e) => setForm({ ...form, marketing: e.target.checked })} />
                <span>Send me occasional offers by SMS (reply STOP any time).</span>
              </label>
            </section>

            <Button variant="brand" size="xl" className="w-full sm:w-auto sm:min-w-72" onClick={submit} loading={submitting} disabled={!me?.authenticated || !ready || !q || q.available === false}>
              {method === "mpesa" ? `Pay ${kes(dueNow)} with M-Pesa` : `Pay ${kes(dueNow)} by card`}
            </Button>
            {!me?.authenticated && <p className="text-sm text-ink-2">Log in above to continue.</p>}
          </div>

          <aside>
            <div className="sticky top-28 rounded-2xl border border-line-soft p-6 shadow-soft">
              <div className="flex gap-4">
                <div className="size-28 shrink-0 overflow-hidden rounded-xl"><Photo src={l.photos[0]?.src} alt={l.name} className="size-full" sizes="120px" /></div>
                <div className="min-w-0">
                  <p className="font-semibold">{l.name}</p>
                  <p className="text-sm text-ink-2">{l.headline}</p>
                  {l.rating && <p className="mt-1 flex items-center gap-1 text-sm"><Star className="size-3.5 fill-ink" /> {l.rating.toFixed(2)} ({l.reviews_count}){l.guest_favourite && " · Guest favourite"}</p>}
                </div>
              </div>
              <Divider className="my-5" />
              <p className="text-[15px]"><b>{ready ? fmtRange(range.from, range.to) : "Dates"}</b> · {guestsLabel(guests)}</p>
              <Divider className="my-5" />
              {!q ? (
                <div className="space-y-2"><Skeleton className="h-4" /><Skeleton className="h-4 w-2/3" /></div>
              ) : (
                <div className={cn("space-y-3 text-[15px]", isFetching && "opacity-60")}>
                  {q.lines.map((line) => (
                    <div key={line.label} className={cn("flex justify-between gap-4", line.amount < 0 && "text-success")}>
                      <span>{line.label}</span><span className="shrink-0 whitespace-nowrap">{line.amount < 0 ? `−${kes(-line.amount)}` : kes(line.amount)}</span>
                    </div>
                  ))}
                  <Divider />
                  <div className="flex justify-between text-base font-bold"><span>Total (KES)</span><span>{kes(q.total)}</span></div>
                  {plan === "deposit" && q.deposit_available && (
                    <div className="rounded-xl bg-surface p-3 text-sm">
                      <div className="flex justify-between font-semibold"><span>Due today</span><span>{kes(q.deposit)}</span></div>
                      <div className="mt-1 flex justify-between text-ink-2"><span>Due {fmtDate(q.balance_due_date)}</span><span>{kes(q.total - q.deposit)}</span></div>
                    </div>
                  )}
                  {config && <p className="text-right text-xs text-ink-2">{approx(q.total, config.currencies, "USD")} · {approx(q.total, config.currencies, "EUR")} · {approx(q.total, config.currencies, "GBP")}</p>}
                </div>
              )}
            </div>
          </aside>
        </div>
      </main>
    </>
  );
}

function PlanOption({ checked, onSelect, title, text, disabled }: { checked: boolean; onSelect: () => void; title: string; text: string; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={onSelect} className={cn("flex w-full items-start justify-between gap-4 border-b border-line p-5 text-left last:border-0 disabled:opacity-40", checked && "bg-surface")}>
      <span>
        <span className="block font-semibold">{title}</span>
        <span className="mt-1 block text-sm text-ink-2">{text}</span>
      </span>
      <span className={cn("mt-1 grid size-6 shrink-0 place-items-center rounded-full border-2", checked ? "border-ink" : "border-ink-3")}>{checked && <span className="size-3 rounded-full bg-ink" />}</span>
    </button>
  );
}

function MethodOption({ checked, onSelect, icon, title, text, disabled }: { checked: boolean; onSelect: () => void; icon: React.ReactNode; title: string; text: string; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={onSelect} className={cn("flex items-start gap-3 rounded-2xl border p-4 text-left transition disabled:opacity-40", checked ? "border-ink ring-1 ring-ink" : "border-line hover:border-ink")}>
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface">{icon}</span>
      <span><span className="block font-semibold">{title}</span><span className="block text-sm text-ink-2">{text}</span></span>
    </button>
  );
}

function Extras({ listing: l, extras, setExtras, guests }: { listing: ListingDetail; extras: Record<string, Extra>; setExtras: (e: Record<string, Extra>) => void; guests: number }) {
  const set = (code: string, patch: Partial<Extra>) => setExtras({ ...extras, [code]: { ...(extras[code] ?? { on: false, details: {} }), ...patch } });
  const list = l.addons.filter((a) => !["mid_stay_clean"].includes(a.code));
  return (
    <section>
      <h2 className="text-[22px] font-bold tracking-tight">Make it yours</h2>
      <p className="mt-1 text-ink-2">Breakfast, pickups and experiences — added to one bill. Requests marked &ldquo;on request&rdquo; are confirmed by Amina by SMS.</p>
      <div className="mt-5 space-y-3">
        {list.map((a: Addon) => {
          const e = extras[a.code] ?? { on: false, details: {} };
          return (
            <div key={a.code} className={cn("rounded-2xl border p-4 transition", e.on ? "border-ink" : "border-line-soft")}>
              <div className="flex items-start gap-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-sand-100"><Icon name={a.icon} className="size-5" /></span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{a.name}</p>
                  <p className="text-sm text-ink-2">{a.short}</p>
                  <p className="mt-1 text-sm font-semibold">{a.price ? `${kes(a.price)} ${a.pricing_label}` : "Free"}{a.requires_approval && <span className="font-normal text-ink-2"> · on request</span>}</p>
                </div>
                <Switch checked={e.on} onCheckedChange={(v) => set(a.code, { on: v, quantity: a.pricing === "per_guest_night" || a.pricing === "per_guest" ? guests : undefined })} aria-label={`Add ${a.name}`} />
              </div>
              {e.on && a.code === "breakfast" && (
                <div className="mt-4 grid gap-3 border-t border-line-soft pt-4 sm:grid-cols-3">
                  <Field label="Style" className="sm:col-span-2">
                    <Select value={e.details.style} onChange={(ev) => set(a.code, { details: { ...e.details, style: ev.target.value } })}>
                      {Object.entries(STYLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </Select>
                  </Field>
                  <Field label="Time"><Input type="time" value={e.details.time ?? "08:00"} onChange={(ev) => set(a.code, { details: { ...e.details, time: ev.target.value } })} /></Field>
                  <div className="sm:col-span-3">
                    <p className="mb-2 text-[13px] font-semibold">Dietary needs</p>
                    <div className="flex flex-wrap gap-2">
                      {(a.options.dietary ?? []).map((d) => {
                        const on = (e.details.dietary ?? "").split(", ").includes(d);
                        return (
                          <button key={d} type="button" onClick={() => {
                            const cur = (e.details.dietary ?? "").split(", ").filter(Boolean);
                            set(a.code, { details: { ...e.details, dietary: (on ? cur.filter((x) => x !== d) : [...cur, d]).join(", ") } });
                          }} className={cn("rounded-full border px-3 py-1.5 text-sm", on ? "border-ink bg-ink text-white" : "border-line hover:border-ink")}>
                            {d}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
              {e.on && (a.code === "airport_pickup" || a.code === "sgr_pickup") && (
                <div className="mt-4 grid gap-3 border-t border-line-soft pt-4 sm:grid-cols-2">
                  <Field label={a.code === "airport_pickup" ? "Flight number" : "Train"}><Input value={e.details.flight ?? ""} onChange={(ev) => set(a.code, { details: { ...e.details, flight: ev.target.value.toUpperCase() } })} placeholder={a.code === "airport_pickup" ? "KQ612" : "Madaraka Express"} /></Field>
                  <Field label="Arrival time"><Input type="time" value={e.details.time ?? ""} onChange={(ev) => set(a.code, { details: { ...e.details, time: ev.target.value } })} /></Field>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PaymentFlow({ result, listing }: { result: { booking: Trip; payment: PaymentResult }; listing?: ListingDetail }) {
  const { data: config } = useConfig();
  const ref = result.booking.ref;
  const { data: trip } = useQuery({
    queryKey: ["trip", ref, "pay"],
    queryFn: () => get<Trip>(`/api/bookings/${ref}`),
    refetchInterval: (q) => (q.state.data && ["confirmed", "checked_in", "expired", "cancelled"].includes(q.state.data.status) ? false : 2000),
    initialData: result.booking,
  });
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const [busy, setBusy] = React.useState(false);
  const status = trip?.status ?? "held";
  const p = result.payment;
  const left = trip?.hold_expires_at ? Math.max(0, Math.floor((new Date(trip.hold_expires_at).getTime() - now) / 1000)) : 0;

  async function retry(method?: "mpesa" | "card") {
    setBusy(true);
    try {
      const r = await post<PaymentResult>(`/api/bookings/${ref}/pay`, { method });
      if (r.method === "card" && r.checkout_url) window.location.href = r.checkout_url;
      else toast.success("We've sent a new M-Pesa prompt to your phone.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SiteHeader />
      <main className="container-narrow max-w-[720px] py-16">
        {status === "confirmed" || status === "checked_in" ? (
          <div className="text-center animate-slide-up">
            <CheckCircle2 className="mx-auto size-16 text-success" strokeWidth={1.5} />
            <h1 className="mt-6 text-[32px] font-bold tracking-tight">You&apos;re booked!</h1>
            <p className="mt-2 text-lg text-ink-2">{listing?.name} · {fmtRange(trip?.check_in, trip?.check_out)} · Ref <b className="text-ink">{ref}</b></p>
            <div className="mx-auto mt-10 max-w-md space-y-4 text-left">
              {[
                ["Now", "Confirmation by SMS with your trip link"],
                ["3 days before", "We ask about breakfast, arrival time and travel"],
                ["Day before", "Directions, landmark and Wi-Fi by SMS"],
                ["Arrival morning", "Your door code arrives by SMS"],
              ].map(([when, what]) => (
                <div key={when} className="flex gap-4">
                  <span className="mt-1.5 size-2.5 shrink-0 rounded-full bg-brand-500" />
                  <p><b>{when}</b> — <span className="text-ink-2">{what}</span></p>
                </div>
              ))}
            </div>
            <Button asChild variant="brand" size="xl" className="mt-10"><Link href={`/trips/${ref}`}>View your trip</Link></Button>
          </div>
        ) : status === "expired" || status === "cancelled" ? (
          <div className="text-center">
            <h1 className="text-[28px] font-bold">Your hold expired</h1>
            <p className="mt-2 text-ink-2">We didn&apos;t receive payment in time, so the home was released. It may still be free — try again.</p>
            <Button asChild className="mt-8"><Link href={listing ? `/stays/${listing.slug}` : "/"}>Back to the listing</Link></Button>
          </div>
        ) : p.method === "card" ? (
          <div className="text-center">
            <CreditCard className="mx-auto size-14 text-ink-2" strokeWidth={1.4} />
            <h1 className="mt-6 text-[28px] font-bold">Finish paying by card</h1>
            <p className="mt-2 text-ink-2">We&apos;re holding {listing?.name} for you for {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}.</p>
            {p.checkout_url && <Button asChild variant="brand" size="xl" className="mt-8"><a href={p.checkout_url}>Open secure checkout</a></Button>}
            {p.error && <p className="mt-4 text-danger">{p.error}</p>}
          </div>
        ) : (
          <div className="text-center">
            <div className="relative mx-auto grid size-28 place-items-center rounded-[28px] border-4 border-ink bg-white">
              <Smartphone className="size-12" strokeWidth={1.3} />
              <span className="absolute -top-2 -right-2 grid size-9 place-items-center rounded-full bg-brand-500 text-white animate-pulse-ring"><Spinner className="size-4 text-white" /></span>
            </div>
            <h1 className="mt-8 text-[28px] font-bold tracking-tight">Check your phone</h1>
            <p className="mx-auto mt-2 max-w-md text-lg text-ink-2">
              Enter your M-Pesa PIN to pay <b className="text-ink">{kes(p.amount)}</b> for {listing?.name}. Your booking confirms the moment it goes through.
            </p>
            {p.error && <p className="mt-4 text-danger">{p.error}</p>}
            <p className="mt-6 text-sm text-ink-2">Holding your dates for <b className="text-ink tabular-nums">{Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</b> · Ref {ref}</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button variant="soft" onClick={() => retry("mpesa")} loading={busy}>Resend M-Pesa prompt</Button>
              <Button variant="soft" onClick={() => retry("card")} disabled={busy}>Pay by card instead</Button>
              {config?.demo && (
                <Button variant="ocean" onClick={async () => { await post(`/api/demo/pay/${ref}`); }}>Simulate payment (demo)</Button>
              )}
            </div>
            <p className="mt-10 text-xs text-ink-2">Paybill prompts come only from M-Pesa · {fmtTime(new Date(now).toISOString())}</p>
          </div>
        )}
      </main>
    </>
  );
}

function CheckoutSkeleton() {
  return (
    <>
      <SiteHeader />
      <main className="container-narrow max-w-[1160px] pt-8">
        <Skeleton className="h-9 w-64" />
        <div className="mt-8 grid gap-20 lg:grid-cols-[1fr_420px]">
          <div className="space-y-6"><Skeleton className="h-40" /><Skeleton className="h-40" /></div>
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      </main>
    </>
  );
}
