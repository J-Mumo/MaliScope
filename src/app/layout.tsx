import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MaliScope | Apartment underwriting",
  description:
    "Auditable apartment-block discovery and cash-flow underwriting for Kenya.",
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
