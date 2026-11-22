import type { Metadata } from "next";
import "./globals.css";
import "./text-size.css";
import SiteHeader from "./site-header";
import {TextSizeProvider} from "./text-size";

export const metadata: Metadata = {
  title: "Bndrm | Play together",
  description: "Shared stems, click, and musician charts.",
  icons: {
    icon: "/branding/bndrm-icon.png",
    shortcut: "/branding/bndrm-icon.png",
    apple: "/branding/bndrm-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased"><TextSizeProvider><SiteHeader/>{children}</TextSizeProvider></body>
    </html>
  );
}
