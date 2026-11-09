import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "UniSchedule AI | Timetable Explorer",
  description: "Explore lecturer and room timetables from historical reference data.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
