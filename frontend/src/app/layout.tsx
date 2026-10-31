import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Public_Sans } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const sans = Public_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Agent Command Center | Copilot Usage",
  description: "Copilot usage, agent activity, and model cost analytics.",
};

export const viewport: Viewport = {
  colorScheme: "dark light",
  themeColor: "#171719",
};

// Applies the saved theme before first paint so light-mode users never see a dark flash.
const themeBootstrap = `try{if(localStorage.getItem("signal-theme")==="light"){document.documentElement.dataset.theme="light"}}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
