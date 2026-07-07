import { ThemeProvider } from "next-themes";
import { Toaster } from "./sonner";

interface AppShellProps {
  children: React.ReactNode;
  lang?: string;
}

export function AppShell({ children, lang = "en" }: AppShellProps) {
  return (
    <html lang={lang} suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <ThemeProvider attribute="data-theme" defaultTheme="dark" disableTransitionOnChange>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
