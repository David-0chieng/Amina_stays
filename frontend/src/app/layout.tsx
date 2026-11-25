import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";

import { Providers } from "@/components/providers";

import "./globals.css";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin", "latin-ext"], variable: "--font-jakarta", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Amina Stays · Coastal homes in Mombasa", template: "%s · Amina Stays" },
  description:
    "Book thoughtfully hosted apartments, cottages and family homes in Nyali, Diani, Old Town, Bamburi and Mtwapa — on the web, by SMS, USSD or a phone call.",
  applicationName: "Amina Stays",
  openGraph: { siteName: "Amina Stays", type: "website", locale: "en_KE" },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={jakarta.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
