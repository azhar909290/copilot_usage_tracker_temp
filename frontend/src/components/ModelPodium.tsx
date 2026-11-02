"use client";

import { Crown, Medal, Award, Sparkles, TrendingUp } from "lucide-react";
import { useState, useMemo, type CSSProperties } from "react";
import { formatCompact, formatCount, formatMoney } from "@/lib/format";
import type { Share } from "@/lib/usage";
import "./ModelPodium.css";

export type PodiumMetric = "tokens" | "calls" | "cost";

const PODIUM_CONFIG = {
  1: {
    rank: 1,
    title: "1st Place",
    label: "Champion",
    icon: Crown,
    height: 195,
    order: 2, // Center
    badgeClass: "is-gold",
    glowColor: "rgba(245, 158, 11, 0.35)",
    borderColor: "rgba(245, 158, 11, 0.65)",
    bgGradient: "linear-gradient(180deg, rgba(245, 158, 11, 0.22) 0%, rgba(245, 158, 11, 0.04) 100%)",
    accentColor: "#f59e0b",
  },
  2: {
    rank: 2,
    title: "2nd Place",
    label: "Runner up",
    icon: Award,
    height: 145,
    order: 1, // Left
    badgeClass: "is-silver",
    glowColor: "rgba(148, 163, 184, 0.3)",
    borderColor: "rgba(148, 163, 184, 0.55)",
    bgGradient: "linear-gradient(180deg, rgba(148, 163, 184, 0.18) 0%, rgba(148, 163, 184, 0.03) 100%)",
    accentColor: "#cbd5e1",
  },
  3: {
    rank: 3,
    title: "3rd Place",
    label: "Third",
    icon: Medal,
    height: 110,
    order: 3, // Right
    badgeClass: "is-bronze",
    glowColor: "rgba(217, 119, 6, 0.3)",
    borderColor: "rgba(217, 119, 6, 0.55)",
    bgGradient: "linear-gradient(180deg, rgba(217, 119, 6, 0.18) 0%, rgba(217, 119, 6, 0.03) 100%)",
    accentColor: "#d97706",
  },
};

export function ModelPodium({
  shares,
  currency,
  totalTokens,
  totalCalls,
  totalCost,
  onPickModel,
}: {
  shares: Share[];
  currency: string;
  totalTokens: number;
  totalCalls: number;
  totalCost: number;
  onPickModel: (model: string) => void;
}) {
  const [metric, setMetric] = useState<PodiumMetric>("tokens");

  const rankedModels = useMemo(() => {
    return [...shares].sort((a, b) => {
      if (metric === "tokens") return b.tokens - a.tokens;
      if (metric === "calls") return b.calls - a.calls;
      return b.cost - a.cost;
    });
  }, [shares, metric]);

  if (!shares.length) return null;

  const top3 = rankedModels.slice(0, 3);
  const runnersUp = rankedModels.slice(3);

  // Reorder for podium display: [2nd, 1st, 3rd]
  const podiumEntries: {
    model: Share;
    config: typeof PODIUM_CONFIG[1];
  }[] = [];

  if (top3[1]) podiumEntries.push({ model: top3[1], config: PODIUM_CONFIG[2] });
  if (top3[0]) podiumEntries.push({ model: top3[0], config: PODIUM_CONFIG[1] });
  if (top3[2]) podiumEntries.push({ model: top3[2], config: PODIUM_CONFIG[3] });

  const getMetricDisplay = (model: Share) => {
    if (metric === "tokens") {
      const share = totalTokens ? ((model.tokens / totalTokens) * 100).toFixed(1) : "0";
      return {
        primary: formatCompact(model.tokens),
        unit: "tokens",
        share: `${share}%`,
        secondary: `${formatCount(model.calls)} calls · ${formatMoney(model.cost, currency)}`,
      };
    }
    if (metric === "calls") {
      const share = totalCalls ? ((model.calls / totalCalls) * 100).toFixed(1) : "0";
      return {
        primary: formatCount(model.calls),
        unit: "calls",
        share: `${share}%`,
        secondary: `${formatCompact(model.tokens)} tokens · ${formatMoney(model.cost, currency)}`,
      };
    }
    const share = totalCost ? ((model.cost / totalCost) * 100).toFixed(1) : "0";
    return {
      primary: formatMoney(model.cost, currency),
      unit: "cost",
      share: `${share}%`,
      secondary: `${formatCompact(model.tokens)} tokens · ${formatCount(model.calls)} calls`,
    };
  };

  return (
    <section className="block model-podium-block" aria-label="Model performance podium">
      <header className="block-head">
        <div className="block-title">
          <div className="podium-head-tag">
            <Sparkles size={13} aria-hidden="true" />
            <span>Leaderboard</span>
          </div>
          <h2>Model podium</h2>
          <p>Top inference models ranked by usage. Select any pedestal to filter the dashboard.</p>
        </div>

        {/* Metric Switcher Segmented Control */}
        <div className="podium-switcher" role="radiogroup" aria-label="Podium ranking metric">
          <button
            type="button"
            role="radio"
            aria-checked={metric === "tokens"}
            className={`podium-switch-btn ${metric === "tokens" ? "is-active" : ""}`}
            onClick={() => setMetric("tokens")}
          >
            Tokens
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={metric === "calls"}
            className={`podium-switch-btn ${metric === "calls" ? "is-active" : ""}`}
            onClick={() => setMetric("calls")}
          >
            Calls
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={metric === "cost"}
            className={`podium-switch-btn ${metric === "cost" ? "is-active" : ""}`}
            onClick={() => setMetric("cost")}
          >
            Cost
          </button>
        </div>
      </header>

      {/* Podium Stage */}
      <div className="podium-stage">
        <div className="podium-grid">
          {podiumEntries.map(({ model, config }) => {
            const Icon = config.icon;
            const display = getMetricDisplay(model);
            const isFirst = config.rank === 1;

            return (
              <div
                key={model.name}
                className={`podium-col order-${config.order} ${config.badgeClass} ${isFirst ? "is-champion" : ""}`}
                style={
                  {
                    "--pillar-height": `${config.height}px`,
                    "--pillar-glow": config.glowColor,
                    "--pillar-border": config.borderColor,
                    "--pillar-bg": config.bgGradient,
                    "--pillar-accent": config.accentColor,
                  } as CSSProperties
                }
              >
                {/* Floating Top Card */}
                <button
                  type="button"
                  className="podium-card"
                  onClick={() => onPickModel(model.name)}
                  aria-label={`${config.title}: ${model.name}. ${display.primary} ${display.unit}, ${display.share} of total. Click to filter.`}
                >
                  <div className="podium-badge">
                    <Icon size={isFirst ? 18 : 15} aria-hidden="true" />
                    <span className="podium-rank-num">#{config.rank}</span>
                  </div>

                  <span className="podium-model-name" title={model.name}>
                    {model.name}
                  </span>

                  <div className="podium-stat-main">
                    <span className="podium-val">{display.primary}</span>{" "}
                    <span className="podium-unit">{display.unit}</span>
                  </div>

                  <span className="podium-share-tag">
                    <TrendingUp size={11} aria-hidden="true" />{" "}{display.share}
                  </span>

                  <span className="podium-sub">{display.secondary}</span>
                </button>

                {/* 3D Pillar Pedestal */}
                <div
                  className="podium-pillar"
                  role="button"
                  tabIndex={0}
                  onClick={() => onPickModel(model.name)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onPickModel(model.name);
                    }
                  }}
                  title={`Filter to ${model.name}`}
                  aria-label={`Filter dashboard to ${model.name}`}
                >
                  <div className="pillar-top-bevel" />
                  <div className="pillar-body">
                    <span className="pillar-large-rank">{config.rank}</span>
                    <span className="pillar-label">{config.label}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Podium Base Floor */}
        <div className="podium-base-floor" aria-hidden="true" />
      </div>

      {/* Runners Up strip for models outside the top 3 */}
      {runnersUp.length > 0 && (
        <div className="podium-runners-up" aria-label="Other active models">
          <span className="runners-up-title">Runners up:</span>
          <div className="runners-up-pills">
            {runnersUp.map((model, idx) => {
              const rank = idx + 4;
              const display = getMetricDisplay(model);
              return (
                <button
                  key={model.name}
                  type="button"
                  className="runner-pill"
                  onClick={() => onPickModel(model.name)}
                  title={`Filter to ${model.name}`}
                >
                  <span className="runner-rank">#{rank}</span>{" "}
                  <span className="runner-name">{model.name}</span>{" "}
                  <span className="runner-val">{display.primary}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

