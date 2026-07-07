"use client";

import * as React from "react";

import { cn } from "@si/ui/lib/utils";

interface DialProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  notches?: number;
  label?: string;
  formatValue?: (value: number) => string;
  className?: string;
}

function Dial({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  notches = 11,
  label,
  formatValue = (v) => v.toString(),
  className,
}: DialProps) {
  const [isDragging, setIsDragging] = React.useState(false);
  const trackRef = React.useRef<HTMLDivElement>(null);
  const dragStartRef = React.useRef<{ x: number; value: number } | null>(null);

  const clampValue = React.useCallback(
    (val: number) => {
      return Math.max(min, Math.min(max, val));
    },
    [min, max],
  );

  const getPercentage = React.useCallback(
    (val: number) => {
      return ((val - min) / (max - min)) * 100;
    },
    [min, max],
  );

  const handlePointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(true);

      // Store starting position and value for delta-based dragging
      dragStartRef.current = {
        x: e.clientX,
        value: value,
      };

      // Capture pointer for smooth dragging
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [value],
  );

  const handlePointerMove = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging || !trackRef.current || !dragStartRef.current) return;

      const rect = trackRef.current.getBoundingClientRect();
      const deltaX = e.clientX - dragStartRef.current.x;

      // Convert pixel delta to value delta
      // INVERTED: Dragging left = increasing value, dragging right = decreasing value
      // This makes it behave like a physical dial
      const valueRange = max - min;
      const valueDelta = (-deltaX / rect.width) * valueRange;

      const newValue = dragStartRef.current.value + valueDelta;
      const steppedValue = Math.round(newValue / step) * step;
      const clampedValue = clampValue(steppedValue);

      onChange(clampedValue);
    },
    [isDragging, min, max, step, clampValue, onChange],
  );

  const handlePointerUp = React.useCallback(() => {
    setIsDragging(false);
    dragStartRef.current = null;
  }, []);

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      let newValue = value;

      switch (e.key) {
        case "ArrowRight":
        case "ArrowUp":
          e.preventDefault();
          newValue = clampValue(value + step);
          break;
        case "ArrowLeft":
        case "ArrowDown":
          e.preventDefault();
          newValue = clampValue(value - step);
          break;
        case "Home":
          e.preventDefault();
          newValue = min;
          break;
        case "End":
          e.preventDefault();
          newValue = max;
          break;
        default:
          return;
      }

      onChange(newValue);
    },
    [value, step, min, max, clampValue, onChange],
  );

  const percentage = getPercentage(value);

  // Calculate translation offset for the notch track
  // When value is at min (0%), notches shift right so first notch is at center
  // When value is at max (100%), notches shift left so last notch is at center
  // Translation is negative of percentage offset from center
  const notchTrackTranslatePercent = 50 - percentage;

  // Generate notch positions (in the extended track space)
  // Add extra notches beyond min/max range to ensure track always appears full
  const notchPositions = React.useMemo(() => {
    if (notches <= 0) return [];
    if (notches === 1) return [50]; // Single notch at center

    // Calculate spacing between notches
    const spacing = 100 / (notches - 1);

    // Add ~50% worth of extra notches on each side
    // This ensures notches are visible even when slider is at min (0%) or max (100%)
    const extraNotches = Math.ceil(notches / 2);
    const totalNotches = notches + extraNotches * 2;

    // Generate positions: start at -50% (extra notches before), end at 150% (extra notches after)
    const startPosition = -extraNotches * spacing;

    return Array.from({ length: totalNotches }, (_, i) => startPosition + i * spacing);
  }, [notches]);

  return (
    <div className={cn("flex items-center gap-3", className)}>
      {label && (
        <span className="text-xs font-bold uppercase tracking-wide text-foreground">{label}</span>
      )}

      <div
        ref={trackRef}
        role="slider"
        aria-label={label || "Slider"}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={formatValue(value)}
        aria-orientation="horizontal"
        tabIndex={0}
        className={cn(
          "relative flex h-10 flex-1 cursor-grab items-center outline-none",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          isDragging && "cursor-grabbing",
        )}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onKeyDown={handleKeyDown}
      >
        {/* Track container with overflow hidden */}
        <div className="relative h-8 w-full overflow-hidden border-2 border-foreground bg-surface-sunken">
          {/* Scrolling notch track */}
          <div
            className="absolute inset-0 flex items-center"
            style={{
              transform: `translate3d(${notchTrackTranslatePercent}%, 0, 0)`,
              transition: isDragging ? "none" : "transform 150ms ease-out",
              willChange: isDragging ? "transform" : "auto",
            }}
          >
            {/* Extended track to allow notches to scroll beyond visible area */}
            <div className="relative h-full w-full">
              {/* Notches - thicker, taller, white for high contrast */}
              {notchPositions.map((pos, i) => (
                <div
                  key={i}
                  className="absolute top-1/2 w-[2px] -translate-x-1/2 -translate-y-1/2 h-5 bg-white"
                  style={{ left: `${pos}%` }}
                />
              ))}
            </div>
          </div>

          {/* Fixed center indicator (always in the middle) */}
          <div className="absolute left-1/2 top-1/2 z-10 h-full w-1 -translate-x-1/2 -translate-y-1/2 border-2 border-foreground bg-sprout shadow-[0_0_8px_rgba(255,87,34,0.5)]">
            {/* Indicator arrow/pointer */}
            <div className="absolute left-1/2 top-0 h-0 w-0 -translate-x-1/2 -translate-y-full border-x-4 border-b-4 border-x-transparent border-b-sprout" />
          </div>
        </div>
      </div>

      {/* Value display */}
      <span className="min-w-[3rem] text-right text-xs font-bold uppercase tracking-wide text-foreground">
        {formatValue(value)}
      </span>
    </div>
  );
}

export { Dial };
