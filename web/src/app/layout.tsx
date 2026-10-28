import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";

export const metadata: Metadata = {
  title: "UpdatePilot",
  description: "Software update intelligence and management for Windows",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply the saved theme before the page paints (prevents a flash) */}
        <script
          dangerouslySetInnerHTML={{
            __html: "try{var t=localStorage.getItem('up-theme');if(t)document.documentElement.dataset.theme=t}catch(e){}",
          }}
        />
      </head>
            <body className="min-h-screen antialiased" suppressHydrationWarning>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}