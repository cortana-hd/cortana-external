import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";

export const metadata: Metadata = {
  title: "Mission Control | Cortana",
  description:
    "Operational dashboard for Cortana agents, runs, and health signals.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen overflow-x-hidden bg-muted/50 antialiased">
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="min-w-0 w-full flex-1 px-4 pt-24 pb-6 sm:px-6 sm:pb-8 md:pt-8">
            <div className="mx-auto max-w-6xl">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
