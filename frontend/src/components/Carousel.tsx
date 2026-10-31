"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Children,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

type DragState = { id: number; x: number; y: number; time: number; moved: boolean };

/**
 * A sliding carousel whose geometry lives in CSS viewport units: each slide is a `vw`-based
 * fraction of the canvas (`--slide`), and the track travels `--index` slides in `vw`.
 * JavaScript only owns the index, drag offset, autoplay and accessibility.
 */
export function Carousel({
  label,
  heading,
  meta,
  interval = 7000,
  children,
}: {
  label: string;
  heading: ReactNode;
  meta?: ReactNode;
  interval?: number;
  children: ReactNode;
}) {
  const slides = Children.toArray(children);
  const count = slides.length;
  const rootRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClick = useRef(false);
  const shownIndex = useRef(0);
  const [index, setIndex] = useState(0);
  const [perView, setPerView] = useState(3);
  const [playing, setPlaying] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const [pageHidden, setPageHidden] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);

  const inView = Math.max(1, Math.floor(perView + 0.01));
  const lastIndex = Math.max(0, count - inView);
  const current = Math.min(index, lastIndex);
  const autoplay =
    playing && !hovered && !keyboardFocus && !pageHidden && !reducedMotion && drag === null && lastIndex > 0;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const read = () => {
      const value = parseFloat(getComputedStyle(root).getPropertyValue("--per-view"));
      if (Number.isFinite(value) && value > 0) setPerView(value);
      // 100vw includes a classic scrollbar; expose its width so vw-based slides land on the canvas edge.
      document.documentElement.style.setProperty(
        "--scrollbar",
        `${Math.max(0, window.innerWidth - document.documentElement.clientWidth)}px`,
      );
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    const visibility = () => setPageHidden(document.visibilityState === "hidden");
    update();
    visibility();
    query.addEventListener("change", update);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      query.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  const goTo = useCallback(
    (target: number, wrap = true) => {
      const next = wrap
        ? target > lastIndex
          ? 0
          : target < 0
            ? lastIndex
            : target
        : Math.max(0, Math.min(lastIndex, target));
      setIndex(next);
    },
    [lastIndex],
  );

  useEffect(() => {
    if (!autoplay) return;
    const timer = window.setTimeout(() => goTo(current + 1), interval);
    return () => window.clearTimeout(timer);
  }, [autoplay, current, goTo, interval]);

  // Content trails the track by a few vw, so each move reads with a little depth.
  useEffect(() => {
    const previous = shownIndex.current;
    shownIndex.current = current;
    if (previous === current || reducedMotion) return;
    const direction = current > previous ? 1 : -1;
    trackRef.current?.querySelectorAll<HTMLElement>("[data-slide-body]").forEach((body, position) => {
      body.animate(
        [
          { transform: `translateX(${direction * 3.5}vw)`, opacity: 0.4 },
          { transform: "translateX(0)", opacity: 1 },
        ],
        {
          duration: 900,
          delay: Math.max(0, position - current) * 45,
          easing: "cubic-bezier(0.16, 1, 0.3, 1)",
          fill: "backwards",
        },
      );
    });
  }, [current, reducedMotion]);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || lastIndex === 0) return;
    dragRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, time: performance.now(), moved: false };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const state = dragRef.current;
    if (!state || state.id !== event.pointerId) return;
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    if (!state.moved) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
        dragRef.current = null;
        return;
      }
      if (Math.abs(dx) < 6) return;
      state.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    const pastEdge = (current === 0 && dx > 0) || (current === lastIndex && dx < 0);
    setDrag(pastEdge ? dx * 0.3 : dx);
  }

  function onPointerEnd(event: PointerEvent<HTMLDivElement>) {
    const state = dragRef.current;
    dragRef.current = null;
    if (!state || state.id !== event.pointerId || !state.moved) return;
    suppressClick.current = true;
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 0);
    const dx = event.clientX - state.x;
    const velocity = dx / Math.max(1, performance.now() - state.time);
    const slideWidth = trackRef.current?.firstElementChild?.getBoundingClientRect().width || 1;
    let steps = Math.round(-dx / slideWidth);
    if (!steps && (Math.abs(dx) > slideWidth * 0.16 || Math.abs(velocity) > 0.45)) steps = dx < 0 ? 1 : -1;
    setDrag(null);
    if (steps) goTo(current + steps, false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, number> = { ArrowRight: current + 1, ArrowLeft: current - 1, Home: 0, End: lastIndex };
    if (!(event.key in moves)) return;
    event.preventDefault();
    goTo(moves[event.key], false);
  }

  const style = { "--index": current, "--drag": `${drag ?? 0}px` } as CSSProperties;

  return (
    <section
      ref={rootRef}
      className="carousel"
      style={style}
      aria-roledescription="carousel"
      aria-label={label}
      data-dragging={drag !== null || undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={(event) => {
        if (event.target.matches(":focus-visible")) setKeyboardFocus(true);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setKeyboardFocus(false);
      }}
    >
      <header className="block-head">
        <div className="block-title">{heading}</div>
        <div className="carousel-controls">
          {meta}
          {lastIndex > 0 && !reducedMotion && (
            <button className="text-button" type="button" aria-pressed={!playing} onClick={() => setPlaying((value) => !value)}>
              {playing ? "Pause" : "Play"}
            </button>
          )}
          <button className="icon-button" type="button" aria-label="Previous" disabled={lastIndex === 0} onClick={() => goTo(current - 1)}>
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <button className="icon-button" type="button" aria-label="Next" disabled={lastIndex === 0} onClick={() => goTo(current + 1)}>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div
        className="carousel-viewport"
        tabIndex={0}
        aria-live={autoplay ? "off" : "polite"}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClickCapture={(event) => {
          if (!suppressClick.current) return;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <div className="carousel-track" ref={trackRef}>
          {slides.map((slide, position) => {
            const visible = position >= current && position < current + inView;
            return (
              <div
                className="carousel-slide"
                key={position}
                role="group"
                aria-roledescription="slide"
                aria-label={`${position + 1} of ${count}`}
                data-visible={visible || undefined}
                inert={!visible}
              >
                <div className="carousel-slide-body" data-slide-body>
                  {slide}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {lastIndex > 0 && (
        <div className="carousel-pages" role="group" aria-label="Choose a position">
          {Array.from({ length: lastIndex + 1 }, (_, page) => (
            <button
              className="carousel-page"
              type="button"
              key={page}
              aria-label={`Show from slide ${page + 1}`}
              aria-current={page === current}
              onClick={() => goTo(page, false)}
            >
              {String(page + 1).padStart(2, "0")}
              {page === current && (
                <span
                  className="carousel-progress"
                  key={`${current}-${autoplay}`}
                  data-running={autoplay || undefined}
                  style={{ animationDuration: `${interval}ms` }}
                />
              )}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
