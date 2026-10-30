import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Linuxtermial — Isolated Linux Workspace",
  description: "A private browser-based Linux terminal powered by isolated Vercel Sandboxes."
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}