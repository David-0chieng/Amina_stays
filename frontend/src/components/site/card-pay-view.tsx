"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, CreditCard, Lock, XCircle } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";

import { Logo } from "@/components/host/shell";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/misc";
import { get, post } from "@/lib/api";
import { fmtRange, kes } from "@/lib/format";

type CardSession = {
  ref: string; unit: string; check_in: string; check_out: string; amount: number; currency: string; status: string;
  booking_status: string; expires_at: string | null; expired: boolean; simulated: boolean;
  purpose?: string; change?: { check_in: string; check_out: string } | null;
};

const PURPOSE: Record<string, string> = { deposit: "Deposit", balance: "Balance", addon: "Extras", change: "Date change" };

/** Stand-in for a hosted card checkout (Paystack in production) so the full flow works offline. */
export function CardPayView({ token }: { token: string }) {
  const { data: s, refetch, isLoading, error } = useQuery({ queryKey: ["card", token], queryFn: () => get<CardSession>(`/api/pay/card/${token}`) });
  const [card, setCard] = React.useState({ number: "4084 0840 8408 4081", expiry: "12/30", cvc: "408", name: "" });
  const [busy, setBusy] = React.useState<string | null>(null);

  async function act(action: "pay" | "decline") {
    setBusy(action);
    try {
      await new Promise((r) => setTimeout(r, 900));
      await post(`/api/pay/card/${token}`, { action });
      await refetch();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-h-dvh bg-surface">
      <header className="border-b border-line-soft bg-white">
        <div className="container-narrow flex h-16 max-w-[560px] items-center justify-between">
          <span className="flex items-center gap-2 font-bold"><Logo className="size-8 rounded-lg" /> Amina Stays</span>
          <span className="flex items-center gap-1.5 text-sm text-ink-2"><Lock className="size-4" /> Secure checkout</span>
        </div>
      </header>
      <main className="container-narrow max-w-[560px] py-10">
        {isLoading ? (
          <Skeleton className="h-96 rounded-2xl" />
        ) : error || !s ? (
          <p className="rounded-2xl bg-white p-8 text-center">This payment link isn&apos;t valid. <Link className="underline" href="/trips">Go to your trips</Link></p>
        ) : s.status === "success" ? (
          <Result ok title="Payment successful" text={s.purpose === "change" ? `${kes(s.amount)} paid — your stay at ${s.unit} is now ${fmtRange(s.change?.check_in ?? s.check_in, s.change?.check_out ?? s.check_out)}. Details are on their way by SMS.` : `${kes(s.amount)} paid for ${s.unit}. Your confirmation is on its way by SMS.`} href={`/trips/${s.ref}`} />
        ) : s.expired ? (
          <Result title="This checkout has expired" text="The hold on these dates ran out before payment. The home may still be free — try booking again." href="/" cta="Back to Amina Stays" />
        ) : (
          <div className="overflow-hidden rounded-2xl bg-white shadow-soft">
            <div className="border-b border-line-soft p-6">
              <p className="text-sm text-ink-2">
                {s.purpose && PURPOSE[s.purpose] ? `${PURPOSE[s.purpose]} · ` : ""}{s.unit} · {fmtRange(s.change?.check_in ?? s.check_in, s.change?.check_out ?? s.check_out)} · Ref {s.ref}
              </p>
              <p className="mt-1 text-[32px] font-bold tracking-tight">{kes(s.amount)}</p>
              {s.status === "failed" && <p className="mt-2 flex items-center gap-2 text-sm text-danger"><XCircle className="size-4" /> Your card was declined. Try again or use another card.</p>}
            </div>
            <div className="space-y-4 p-6">
              <Field label="Card number"><Input inputMode="numeric" value={card.number} onChange={(e) => setCard({ ...card, number: e.target.value })} autoComplete="cc-number" /></Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Expiry"><Input value={card.expiry} onChange={(e) => setCard({ ...card, expiry: e.target.value })} autoComplete="cc-exp" /></Field>
                <Field label="CVC"><Input inputMode="numeric" value={card.cvc} onChange={(e) => setCard({ ...card, cvc: e.target.value })} autoComplete="cc-csc" /></Field>
              </div>
              <Field label="Name on card"><Input value={card.name} onChange={(e) => setCard({ ...card, name: e.target.value })} autoComplete="cc-name" /></Field>
              <Button variant="brand" size="xl" className="w-full" onClick={() => act("pay")} loading={busy === "pay"} disabled={!!busy}>
                <CreditCard className="size-5" /> Pay {kes(s.amount)}
              </Button>
              {s.simulated && (
                <div className="flex items-center justify-between gap-3 rounded-xl bg-surface p-3 text-xs text-ink-2">
                  <span>Demo checkout — no real card is charged.</span>
                  <button className="font-semibold underline" onClick={() => act("decline")} disabled={!!busy}>Simulate a decline</button>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function Result({ ok, title, text, href, cta = "View your trip" }: { ok?: boolean; title: string; text: string; href: string; cta?: string }) {
  return (
    <div className="rounded-2xl bg-white p-10 text-center shadow-soft">
      {ok ? <CheckCircle2 className="mx-auto size-14 text-success" strokeWidth={1.5} /> : <XCircle className="mx-auto size-14 text-ink-3" strokeWidth={1.5} />}
      <h1 className="mt-5 text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-ink-2">{text}</p>
      <Button asChild size="lg" className="mt-8"><Link href={href}>{cta}</Link></Button>
    </div>
  );
}
