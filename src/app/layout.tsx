import type { Metadata } from "next";
import { Fraunces, Outfit } from "next/font/google";
import { AppShell } from "@/components/shell/AppShell";
import "./globals.css";
import "./vow-final.css";
import "./vow-rebuild.css";
import "./vow-shell-fix.css";
import "@/app/design-system/tokens.css";
import "@/components/ui/ui.css";
import "@/components/shell/shell-ds.css";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
});

export const metadata: Metadata = {
  title: "VOW — Reliable. Correct. Fast.",
  description: "A model-agnostic AI-agent reliability harness.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${outfit.variable} ${fraunces.variable} antialiased`}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
