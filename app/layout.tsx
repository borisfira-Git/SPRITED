import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SPRITED — Sprite Sheet Studio",
  description:
    "Prepare, align, preview and export sprite sheets for Godot AnimatedSprite2D.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title: "SPRITED",
    description: "Prepare. Align. Animate.",
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "SPRITED",
    description: "Prepare. Align. Animate.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
