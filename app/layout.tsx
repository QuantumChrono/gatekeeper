import { Suspense } from "react";
import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { AppSidebar } from "@/components/app-sidebar";

// Two families, both used: Inter carries prose and UI, Geist Mono carries
// identifiers, statuses and timestamps. A third would be a download for nothing.
const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Gatekeeper",
  description:
    "AI prepares the support decision. A human authorizes the action.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={cn("h-full antialiased", inter.variable, geistMono.variable)}
    >
      <body className="flex min-h-full flex-col font-sans">
        <a
          href="#main"
          className="focus-ring sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-3 focus-visible:left-3 focus-visible:z-50 focus-visible:rounded-sm focus-visible:border focus-visible:bg-card focus-visible:px-3 focus-visible:py-2 focus-visible:text-sm focus-visible:font-medium"
        >
          Skip to content
        </a>
        {/* Optimised for a laptop: the sidebar is permanent from lg up. Below
            that it becomes a top bar — a drawer would add a client component
            and a toggle for a layout the demo never runs at. */}
        <div className="flex min-h-full flex-1 flex-col lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
          <header className="border-b bg-sidebar lg:sticky lg:top-0 lg:h-dvh lg:overflow-y-auto lg:border-r lg:border-b-0">
            {/* Nav marks the active surface from the URL, so it reads search
                params — Suspense keeps that out of the layout's render path. */}
            <Suspense fallback={null}>
              <AppSidebar />
            </Suspense>
          </header>
          <main id="main" className="min-w-0 flex-1">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
