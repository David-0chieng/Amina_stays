"use client";

import { Phone, ShieldCheck, Siren } from "lucide-react";
import Link from "next/link";

import { useConfig } from "@/components/providers";

export function SiteFooter() {
  const { data: config } = useConfig();
  const c = config?.channels;
  return (
    <footer className="mt-24 border-t border-line-soft bg-surface pb-24 md:pb-0">
      <div className="container-site grid gap-10 py-12 md:grid-cols-4">
        <div>
          <h3 className="text-sm font-bold">Support</h3>
          <ul className="mt-4 space-y-3 text-sm text-ink-2">
            <li><Link className="hover:underline" href="/help">Help centre</Link></li>
            <li><Link className="hover:underline" href="/help#safety">Safety &amp; emergencies</Link></li>
            <li><Link className="hover:underline" href="/help#cancellations">Cancellation options</Link></li>
            <li><Link className="hover:underline" href="/messages">Message Amina</Link></li>
          </ul>
        </div>
        <div id="book-your-way">
          <h3 className="text-sm font-bold">Book your way</h3>
          <ul className="mt-4 space-y-3 text-sm text-ink-2">
            <li>Website — you&apos;re here</li>
            <li>USSD, no data needed: <b className="text-ink">{c?.ussd_code || "*384*… (shared code)"}</b></li>
            <li>SMS &ldquo;Ask Amina&rdquo;: <b className="text-ink">{c?.sms_number || "our shortcode"}</b></li>
            <li>Voice &ldquo;Call Amina&rdquo; (English / Kiswahili): <b className="text-ink">{c?.voice_number || "our hotline"}</b></li>
          </ul>
        </div>
        <div id="safety">
          <h3 className="text-sm font-bold">In an emergency</h3>
          <ul className="mt-4 space-y-3 text-sm text-ink-2">
            <li className="flex items-center gap-2"><Siren className="size-4 text-danger" /> Police / ambulance: <b className="text-ink">999 or 112</b> (free)</li>
            <li className="flex items-center gap-2"><Phone className="size-4" /> Kenya Red Cross <b className="text-ink">1199</b> · E-Plus <b className="text-ink">1514</b></li>
            <li className="flex items-center gap-2"><ShieldCheck className="size-4 text-ocean-600" /> Text <b className="text-ink">HELP</b> to reach Amina 24/7</li>
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-bold">Amina Stays</h3>
          <ul className="mt-4 space-y-3 text-sm text-ink-2">
            <li><Link className="hover:underline" href="/privacy">Privacy &amp; your data</Link></li>
            <li><Link className="hover:underline" href="/host">Host console</Link></li>
            {config?.business.tra_licence && (
              <li>
                TRA licence <b className="text-ink">{config.business.tra_licence}</b> ·{" "}
                <a className="underline" href="https://verify.tra.go.ke/" target="_blank" rel="noreferrer">verify</a>
              </li>
            )}
          </ul>
        </div>
      </div>
      <div className="border-t border-line-soft">
        <div className="container-site flex flex-wrap items-center justify-between gap-3 py-6 text-sm text-ink-2">
          <p>© 2026 Amina Stays · Mombasa, Kenya · Prices in KES, all fees included</p>
          <p>Built on Africa&apos;s Talking — SMS · USSD · Voice · Airtime · Mobile Data · Insights</p>
        </div>
      </div>
    </footer>
  );
}
