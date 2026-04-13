import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "katex/dist/katex.min.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Constant Recognizer",
  description: "Identify mathematical constants from decimal numbers using brute-force RPN search",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="overflow-hidden">
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} antialiased overflow-hidden max-w-[100vw]`}
      >
        {children}
      </body>
    </html>
  );
}
