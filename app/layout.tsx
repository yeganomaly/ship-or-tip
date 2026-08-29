import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ship or Tip",
  description: "Public build commitments, backed by small tips on Stellar Testnet.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className="dark"><body>{children}</body></html>;
}
