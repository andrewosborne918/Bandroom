import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bandroom | Play together",
  description: "Shared stems, click, and musician charts.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
