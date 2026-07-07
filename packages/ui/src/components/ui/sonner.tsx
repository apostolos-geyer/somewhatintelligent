"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon } from "lucide-react";
import { Spinner } from "./spinner";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4 text-growth" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4 text-pistil" />,
        error: <OctagonXIcon className="size-4 text-stigma" />,
        loading: <Spinner className="size-4" />,
      }}
      style={
        {
          "--normal-bg": "var(--glass-bg)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--glass-border)",
          "--success-bg": "var(--glass-bg)",
          "--success-text": "var(--color-growth)",
          "--success-border": "var(--color-growth)",
          "--error-bg": "var(--glass-bg)",
          "--error-text": "var(--color-stigma)",
          "--error-border": "var(--color-stigma)",
          "--warning-bg": "var(--glass-bg)",
          "--warning-text": "var(--color-pistil)",
          "--warning-border": "var(--color-pistil)",
          "--border-radius": "var(--radius-md)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "glass rounded-md shadow-soft-md font-body",
          description: "text-text-secondary",
          title: "font-semibold",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
export { toast } from "sonner";
