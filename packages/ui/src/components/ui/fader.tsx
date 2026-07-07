"use client";

import * as React from "react";

import { cn } from "@greenroom/ui/lib/utils";

interface FaderProps {
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

function Fader({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  notches = 11,
  label,
  formatValue = (v) => v.toString(),
  className,
}: FaderProps) {
  const [isDragging, setIsDragging] = React.useState(false);
  const trackRef = React.useRef<HTMLDivElement>(null);

  const clampValue = React.useCallback(
    (val: number) => {
      return Math.max(min, Math.min(max, val));
    },
    [min, max],
  );

  const getPercentage = React.useCallback(
    (val: number) => {
      return (val - min) / (max - min);
    },
    [min, max],
  );

  const handlePointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(true);

      const rect = trackRef.current?.getBoundingClientRect();
      if (rect) {
        const y = e.clientY - rect.top;
        const percentage = 1 - Math.max(0, Math.min(1, y / rect.height));
        const valueRange = max - min;
        const newValue = min + percentage * valueRange;
        const steppedValue = Math.round(newValue / step) * step;
        onChange(clampValue(steppedValue));
      }

      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [min, max, step, clampValue, onChange],
  );

  const handlePointerMove = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging || !trackRef.current) return;

      const rect = trackRef.current.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const percentage = 1 - Math.max(0, Math.min(1, y / rect.height));
      const valueRange = max - min;
      const newValue = min + percentage * valueRange;
      const steppedValue = Math.round(newValue / step) * step;
      onChange(clampValue(steppedValue));
    },
    [isDragging, min, max, step, clampValue, onChange],
  );

  const handlePointerUp = React.useCallback(() => {
    setIsDragging(false);
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

  const notchPositions = React.useMemo(() => {
    if (notches <= 0) return [];
    if (notches === 1) return [50];

    return Array.from({ length: notches }, (_, i) => (i / (notches - 1)) * 100);
  }, [notches]);

  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      {label && (
        <span className="shrink-0 text-xs font-bold uppercase tracking-wide text-foreground">
          {label}
        </span>
      )}

      <div
        ref={trackRef}
        role="slider"
        aria-label={label || "Fader"}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={formatValue(value)}
        aria-orientation="vertical"
        tabIndex={0}
        className={cn(
          "relative min-h-16 flex-1 cursor-grab outline-none",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          isDragging && "cursor-grabbing",
        )}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onKeyDown={handleKeyDown}
      >
        <div className="flex h-full items-stretch justify-center gap-1">
          {/* Left notch marks */}
          <div className="relative z-20 flex w-2 flex-col justify-between">
            {notchPositions.map((pos, i) => {
              const isLong = i === 0 || i === notches - 1 || i % 5 === 0;
              return (
                <div
                  key={i}
                  className={cn("h-[1px] bg-foreground", isLong ? "w-2" : "w-1")}
                  style={{
                    position: "absolute",
                    bottom: `${pos}%`,
                    transform: "translateY(50%)",
                  }}
                />
              );
            })}
          </div>

          {/* Track groove */}
          <div className="relative w-3 border-2 border-foreground bg-surface-sunken">
            <div className="absolute inset-0 bg-gradient-to-r from-black/40 via-transparent to-black/20" />
            <div className="absolute bottom-0 left-1/2 top-0 w-[1px] -translate-x-1/2 bg-gray-600" />

            {/* Fill indicator */}
            <div
              className="absolute bottom-0 left-0 right-0 bg-sprout/50"
              style={{ height: `${percentage * 100}%` }}
            />

            {/* Fader knob */}
            <div
              className={cn(
                "absolute left-1/2",
                "h-3.5 w-5",
                "bg-gradient-to-b from-gray-200 via-gray-100 to-gray-300",
                "border-2 border-foreground",
                "shadow-[inset_0_1px_0_rgba(255,255,255,0.8),inset_0_-1px_0_rgba(0,0,0,0.2)]",
                isDragging && "bg-gradient-to-b from-gray-100 via-white to-gray-200",
              )}
              style={{
                bottom: `calc(${percentage * 100}% - 2px - ${percentage * 5}px)`,
                transform: "translateX(-50%)",
              }}
            >
              {/* Grip lines */}
              <div className="absolute inset-x-0.5 top-1/2 flex -translate-y-1/2 flex-col gap-[1px]">
                <div className="h-[1px] bg-gray-400" />
                <div className="h-[1px] bg-gray-400" />
              </div>
              {/* Center indicator */}
              <div className="absolute bottom-0 left-1/2 top-0 w-[2px] -translate-x-1/2 bg-sprout" />
            </div>
          </div>

          {/* Right notch marks */}
          <div className="relative z-20 flex w-2 flex-col justify-between">
            {notchPositions.map((pos, i) => {
              const isLong = i === 0 || i === notches - 1 || i % 5 === 0;
              return (
                <div
                  key={i}
                  className={cn("h-[1px] bg-foreground", isLong ? "w-2" : "w-1")}
                  style={{
                    position: "absolute",
                    right: 0,
                    bottom: `${pos}%`,
                    transform: "translateY(50%)",
                  }}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* Value display */}
      <span className="shrink-0 text-xs font-bold uppercase tracking-wide text-foreground">
        {formatValue(value)}
      </span>
    </div>
  );
}

export { Fader };
export type { FaderProps };
