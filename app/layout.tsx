import type { Metadata } from "next";
import "./globals.css";
import SiteHeader from "./site-header";

export const metadata: Metadata = {
  title: "Bndrm | Play together",
  description: "Shared stems, click, and musician charts.",
  icons: {
    icon: "/branding/bndrm-icon.png",
    shortcut: "/branding/bndrm-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased"><SiteHeader/>{children}</body>
    </html>
  );
}
