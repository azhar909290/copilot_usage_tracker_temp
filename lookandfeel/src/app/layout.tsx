import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./dashboard.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Control Plane | Atlex",
  description: "Explore AI usage, activity, teams, agents, models and GitHub metrics.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `try{var d=document.documentElement;d.dataset.theme=localStorage.getItem("atlex-theme")==="dark"?"dark":"light";d.dataset.motion=localStorage.getItem("signal-motion")==="off"?"reduced":"full"}catch(e){}` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
