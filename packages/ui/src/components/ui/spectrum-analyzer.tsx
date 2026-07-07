"use client";

import { useRef, useEffect, useCallback } from "react";
import { cn } from "@greenroom/ui/lib/utils";

export interface SpectrumAnalyzerProps {
  /** Function to get frequency data */
  getFrequencyData: () => Float32Array | null;
  /** Additional class names */
  className?: string;
  /** Height in pixels */
  height?: number;
  /** Number of bars to display */
  barCount?: number;
  /** Color scheme */
  colorScheme?: "orange" | "gradient";
  /** Whether to mirror the bars (top and bottom) */
  mirror?: boolean;
}

/**
 * Real-time spectrum analyzer visualization component
 *
 * Features:
 * - Real-time frequency data visualization
 * - Canvas-based rendering with requestAnimationFrame
 * - Neo-brutalist styling with solid colors
 * - Configurable bar count and colors
 */
export function SpectrumAnalyzer({
  getFrequencyData,
  className,
  height = 120,
  barCount = 32,
  colorScheme = "orange",
  mirror = true,
}: SpectrumAnalyzerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Draw spectrum on canvas
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Get frequency data
    const frequencyData = getFrequencyData();
    if (!frequencyData) {
      // Draw empty state
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    // Handle high DPI displays
    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth;

    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.scale(dpr, dpr);
    }

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Calculate bar dimensions
    const barWidth = width / barCount;
    const spacing = barWidth * 0.2; // 20% spacing between bars
    const actualBarWidth = barWidth - spacing;

    // Sample frequency data
    const samplesPerBar = Math.floor(frequencyData.length / barCount);

    for (let i = 0; i < barCount; i++) {
      // Calculate average amplitude for this bar
      let sum = 0;
      for (let j = 0; j < samplesPerBar; j++) {
        const index = i * samplesPerBar + j;
        if (index < frequencyData.length) {
          // Tone.Analyser returns values in decibels (typically -100 to 0)
          // Normalize to 0-1 range
          const dbValue = frequencyData[index] ?? -100;
          const normalized = (dbValue + 100) / 100;
          sum += Math.max(0, Math.min(1, normalized));
        }
      }
      const average = sum / samplesPerBar;

      // Apply some smoothing and boost for better visualization
      const boosted = Math.pow(average, 0.7);

      // Calculate bar height
      const maxBarHeight = mirror ? height / 2 - 4 : height - 4;
      const barHeight = Math.max(2, boosted * maxBarHeight);

      // Calculate position
      const x = i * barWidth + spacing / 2;

      // Determine color — read from CSS custom properties for theme awareness
      let fillColor: string;
      const glyphColor = getComputedStyle(document.documentElement)
        .getPropertyValue("--color-sprout")
        .trim();
      const bloodColor = getComputedStyle(document.documentElement)
        .getPropertyValue("--color-stigma")
        .trim();
      if (colorScheme === "orange") {
        fillColor = glyphColor ? `hsl(${glyphColor})` : "hsl(210 60% 62%)";
      } else {
        // Gradient from sprout to stigma based on frequency
        const t = i / barCount;
        fillColor =
          t < 0.5
            ? glyphColor
              ? `hsl(${glyphColor})`
              : "hsl(210 60% 62%)"
            : bloodColor
              ? `hsl(${bloodColor})`
              : "hsl(355 55% 62%)";
      }

      // Set style with thick border
      ctx.fillStyle = fillColor;
      ctx.strokeStyle = "var(--color-bg, #000)";
      ctx.lineWidth = 2;

      if (mirror) {
        // Draw top half (upward)
        const centerY = height / 2;
        ctx.fillRect(x, centerY - barHeight, actualBarWidth, barHeight);
        ctx.strokeRect(x, centerY - barHeight, actualBarWidth, barHeight);

        // Draw bottom half (downward)
        ctx.fillRect(x, centerY, actualBarWidth, barHeight);
        ctx.strokeRect(x, centerY, actualBarWidth, barHeight);
      } else {
        // Draw from bottom up
        const y = height - barHeight - 2;
        ctx.fillRect(x, y, actualBarWidth, barHeight);
        ctx.strokeRect(x, y, actualBarWidth, barHeight);
      }
    }

    // Schedule next frame
    animationFrameRef.current = requestAnimationFrame(draw);
  }, [getFrequencyData, height, barCount, colorScheme, mirror]);

  // Start animation loop
  useEffect(() => {
    animationFrameRef.current = requestAnimationFrame(draw);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [draw]);

  // Handle resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      // Canvas will be resized on next draw
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative w-full border-4 border-foreground bg-surface-sunken shadow-brutal-sm",
        className,
      )}
      style={{ height }}
    >
      <canvas ref={canvasRef} className="absolute inset-0" aria-hidden="true" />
    </div>
  );
}
