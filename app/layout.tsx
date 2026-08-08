import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";

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
        {/* The console chrome is not here: the sidebar's workflow trail reflects
            the open ticket's status, and a layout cannot read that from the page
            below it. The two operator surfaces render <ConsoleShell> themselves,
            which also keeps the customer-facing route from inheriting a sidebar
            it has no business showing. Each surface owns the #main the skip link
            targets. */}
        {children}
      </body>
    </html>
  );
}
