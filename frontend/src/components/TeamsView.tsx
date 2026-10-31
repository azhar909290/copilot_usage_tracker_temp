"use client";

import NumberFlow from "@number-flow/react";
import { ArrowUpRight, Filter } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import { formatAgo, formatCompact, formatCount, formatMoney } from "@/lib/format";
import { summarizeTeams, teamOf, teamToken, type TeamData, type TeamSummary } from "@/lib/teams";
import type { LiveUser, UsageRow } from "@/lib/usage";
import { Donut, Legend, Sparkline, StreamChart } from "./charts";
import { OrgConstellation } from "./OrgConstellation";
import { Person } from "./Person";
import { Reveal, Stagger, StaggerItem } from "./Reveal";
import { Empty, ShareBar, SortHeader, sortBy, useSort } from "./table";

function TeamCard({
  team,
  index,
  selected,
  hues,
  currency,
  onSelect,
}: {
  team: TeamSummary;
  index: number;
  selected: boolean;
  hues: Map<string, number>;
  currency: string;
  onSelect: () => void;
}) {
  const color = `var(${team.token})`;
  const contributors = team.members.filter((member) => member.tokens > 0);
  const faces = team.members.slice(0, 6);
  return (
    <article className="team-card" data-selected={selected || undefined} style={{ "--team": color, "--i": index } as CSSProperties}>
      <header className="team-head">
        <span className="team-orb" aria-hidden="true" style={{ "--i": index } as CSSProperties} />
        <h3>{team.name}</h3>
      </header>
      <div>
        <p className="team-figure num">
          <NumberFlow value={team.tokens} locales="en-US" format={{ notation: "compact", maximumFractionDigits: 2 }} />
          <small>tokens</small>
        </p>
        <p className="team-share">
          <b>{team.share.toFixed(1)}%</b> of organization tokens · {team.members.length} members
        </p>
      </div>
      <div className="team-meter" role="img" aria-label={`Token contribution of ${contributors.length} members`}>
        {contributors.map((member, position) => (
          <span
            key={member.user}
            title={`${member.user}: ${formatCompact(member.tokens)} tokens`}
            style={{ flex: member.tokens, "--hue": hues.get(member.user) ?? 220, "--i": position } as CSSProperties}
          />
        ))}
      </div>
      <dl className="team-stats">
        <div>
          <dt>Calls</dt>
          <dd>{formatCount(team.requests)}</dd>
        </div>
        <div>
          <dt>Est. cost</dt>
          <dd>{formatMoney(team.cost, currency)}</dd>
        </div>
        <div>
          <dt>Active</dt>
          <dd>
            {team.activeMembers}/{team.members.length}
          </dd>
        </div>
      </dl>
      <Sparkline className="team-spark" values={team.daily} color={color} />
      <div className="team-actions">
        <ul className="team-faces" aria-label={`${team.name} members`}>
          {faces.map((member) => (
            <li key={member.user} title={member.user}>
              <Person name={member.user} hue={hues.get(member.user)} />
            </li>
          ))}
          {team.members.length > faces.length && <li className="more">+{team.members.length - faces.length}</li>}
        </ul>
        <button className="text-button" type="button" aria-pressed={selected} onClick={onSelect}>
          {selected ? "Show all" : "Focus"} <ArrowUpRight size={13} aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}

function MembersTable({
  rows,
  teams,
  currency,
  liveUsers,
  now,
  hues,
  focusTeam,
  onPickUser,
}: {
  rows: UsageRow[];
  teams: TeamData;
  currency: string;
  liveUsers: LiveUser[];
  now: number;
  hues: Map<string, number>;
  focusTeam: string | null;
  onPickUser: (user: string) => void;
}) {
  type Key = "user" | "team" | "requests" | "input" | "output" | "tokens" | "cost" | "share";
  const [sort, onSort] = useSort<Key>({ key: "tokens", direction: "desc" }, ["user", "team"]);
  const liveSince = new Map(liveUsers.map((item) => [item.user, item.lastSeen]));
  const metrics = new Map<string, { requests: number; input: number; output: number; cost: number; unpriced: number }>();
  for (const row of rows) {
    const current = metrics.get(row.user) || { requests: 0, input: 0, output: 0, cost: 0, unpriced: 0 };
    current.requests += row.requests;
    current.input += row.input_tokens;
    current.output += row.output_tokens;
    current.cost += row.cost;
    current.unpriced += row.unpriced_requests;
    metrics.set(row.user, current);
  }
  const totalTokens = [...metrics.values()].reduce((sum, measure) => sum + measure.input + measure.output, 0);
  const items = [...metrics.entries()]
    .map(([user, measure]) => {
      const tokens = measure.input + measure.output;
      return { user, team: teamOf(user, teams), ...measure, tokens, share: totalTokens ? (tokens / totalTokens) * 100 : 0 };
    })
    .filter((item) => !focusTeam || item.team === focusTeam);
  const sorted = sortBy(items, sort, (item, key) => item[key]);
  const teamIndex = new Map(teams.names.map((name, index) => [name, index]));
  return (
    <div className="table-frame">
      <table className="table">
        <thead>
          <tr>
            <SortHeader sortKey="user" label="Member" sort={sort} onSort={onSort} />
            <SortHeader sortKey="team" label="Team" sort={sort} onSort={onSort} />
            <SortHeader sortKey="requests" label="Calls" sort={sort} onSort={onSort} numeric />
            <SortHeader sortKey="input" label="Input" sort={sort} onSort={onSort} numeric />
            <SortHeader sortKey="output" label="Output" sort={sort} onSort={onSort} numeric />
            <SortHeader sortKey="tokens" label="Tokens" sort={sort} onSort={onSort} numeric />
            <SortHeader sortKey="cost" label="Est. cost" sort={sort} onSort={onSort} numeric />
            <SortHeader sortKey="share" label="Share" sort={sort} onSort={onSort} numeric />
          </tr>
        </thead>
        <tbody>
          {sorted.map((item, index) => {
            const lastSeen = liveSince.get(item.user);
            const token = teamToken(item.team, teamIndex.get(item.team) ?? 0);
            return (
              <tr key={item.user} className="is-entering" style={{ "--i": index } as CSSProperties}>
                <td>
                  <button type="button" className="share-name" title={`Filter to ${item.user}`} onClick={() => onPickUser(item.user)} style={{ display: "inline-flex" }}>
                    <Person name={item.user} hue={hues.get(item.user)}>
                      {lastSeen !== undefined && (
                        <span className="pill is-positive" title={`Last call ${formatAgo(lastSeen, now)}`}>
                          Live
                        </span>
                      )}
                    </Person>
                  </button>
                </td>
                <td>
                  <span className="pill is-team" style={{ "--team": `var(${token})` } as CSSProperties}>
                    {item.team}
                  </span>
                </td>
                <td className="num">{formatCount(item.requests)}</td>
                <td className="num muted">{formatCount(item.input)}</td>
                <td className="num muted">{formatCount(item.output)}</td>
                <td className="num">{formatCount(item.tokens)}</td>
                <td className="num">
                  <span className="stack is-end">
                    <span>{formatMoney(item.cost, currency)}</span>
                    {item.unpriced > 0 && <small>{formatCount(item.unpriced)} unpriced</small>}
                  </span>
                </td>
                <td className="num">
                  <ShareBar share={item.share} from={`var(${token})`} to={`var(${token})`} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!items.length && <Empty>No member usage in this date range.</Empty>}
    </div>
  );
}

export function TeamsView({
  rows,
  teams,
  days,
  currency,
  liveUsers,
  now,
  hues,
  selectedTeam,
  onSelectTeam,
  onPickUser,
}: {
  rows: UsageRow[];
  teams: TeamData;
  days: string[];
  currency: string;
  liveUsers: LiveUser[];
  now: number;
  hues: Map<string, number>;
  selectedTeam: string | null;
  onSelectTeam: (team: string | null) => void;
  onPickUser: (user: string) => void;
}) {
  const summaries = useMemo(() => summarizeTeams(rows, teams, days), [rows, teams, days]);
  const [streamFocus, setStreamFocus] = useState<string | null>(null);
  const [donutFocus, setDonutFocus] = useState<string | null>(null);
  const totals = summaries.reduce(
    (sum, team) => ({ requests: sum.requests + team.requests, tokens: sum.tokens + team.tokens, cost: sum.cost + team.cost, active: sum.active + team.activeMembers }),
    { requests: 0, tokens: 0, cost: 0, active: 0 },
  );
  const memberCount = Object.keys(teams.assignments).length;
  const maxShare = Math.max(1, ...summaries.map((team) => team.share));
  const focused = summaries.find((team) => team.name === selectedTeam) ?? null;
  const leaders = (focused ? focused.members : summaries.flatMap((team) => team.members))
    .filter((member) => member.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 8);
  const leaderMax = leaders[0]?.tokens ?? 1;
  const tokenOf = new Map(summaries.map((team) => [team.name, team.token]));

  return (
    <>
      <Reveal as="section" className="block org-hero">
        <div className="org-copy">
          <div>
            <h2 className="org-name">{teams.organization}</h2>
            <p className="org-sub">
              {summaries.filter((team) => team.name !== "Unassigned").length} teams · {memberCount} members · {totals.active} active in range
            </p>
          </div>
          <dl className="org-stats">
            <div>
              <dt>Calls</dt>
              <dd className="num">
                <NumberFlow value={totals.requests} locales="en-US" />
              </dd>
            </div>
            <div>
              <dt>Tokens</dt>
              <dd className="num">
                <NumberFlow value={totals.tokens} locales="en-US" format={{ notation: "compact", maximumFractionDigits: 2 }} />
              </dd>
            </div>
            <div>
              <dt>Est. cost</dt>
              <dd className="num">
                <NumberFlow value={totals.cost} locales="en-US" format={{ style: "currency", currency, maximumFractionDigits: 2, minimumFractionDigits: 2 }} />
              </dd>
            </div>
          </dl>
          <ol className="org-legend" aria-label="Teams by token share">
            {summaries.map((team, index) => (
              <li key={team.name}>
                <button
                  type="button"
                  aria-pressed={selectedTeam === team.name}
                  onClick={() => onSelectTeam(selectedTeam === team.name ? null : team.name)}
                  style={{ "--team": `var(${team.token})`, "--fill": team.share / maxShare, "--i": index } as CSSProperties}
                >
                  <i aria-hidden="true" />
                  <strong>{team.name}</strong>
                  <span className="num">{team.members.length} people</span>
                  <span className="num">{team.share.toFixed(1)}%</span>
                </button>
              </li>
            ))}
          </ol>
          {teams.demo && <p className="org-note">Team memberships are saved demo assignments, not HR records.</p>}
        </div>
        <OrgConstellation organization={teams.organization} teams={summaries} currency={currency} selected={selectedTeam} onSelect={onSelectTeam} />
      </Reveal>

      <Stagger className="team-grid" stagger={0.07}>
        {summaries.map((team, index) => (
          <StaggerItem key={team.name} style={{ display: "flex" }}>
            <TeamCard
              team={team}
              index={index}
              selected={selectedTeam === team.name}
              hues={hues}
              currency={currency}
              onSelect={() => onSelectTeam(selectedTeam === team.name ? null : team.name)}
            />
          </StaggerItem>
        ))}
      </Stagger>

      <Reveal as="section" className="block">
        <header className="block-head">
          <div className="block-title">
            <h2>Team pulse</h2>
            <p>Calls per day, stacked by team. Hover a band to isolate it.</p>
          </div>
          <span className="muted">
            <span className="num">{formatCount(totals.requests)}</span> calls
          </span>
        </header>
        <StreamChart
          days={days}
          unit="calls"
          focus={streamFocus ?? selectedTeam}
          onFocus={setStreamFocus}
          series={summaries.map((team) => ({ name: team.name, color: `var(${team.token})`, values: team.daily }))}
        />
        <Legend items={summaries.map((team) => ({ name: team.name, color: `var(${team.token})`, value: formatCount(team.requests) }))} />
      </Reveal>

      <div className="pair">
        <Reveal as="section" className="block">
          <header className="block-head">
            <div className="block-title">
              <h2>Token share by team</h2>
              <p>Select an arc to focus that team everywhere on this page</p>
            </div>
          </header>
          <Donut
            items={summaries.map((team) => ({ name: team.name, value: team.tokens, color: `var(${team.token})` }))}
            label="tokens"
            format={(value) => formatCompact(value)}
            active={donutFocus ?? selectedTeam}
            onActive={setDonutFocus}
            onPick={(name) => onSelectTeam(selectedTeam === name ? null : name)}
            ariaLabel={`Token share by team: ${summaries.map((team) => `${team.name} ${team.share.toFixed(1)}%`).join(", ")}`}
          />
        </Reveal>
        <Reveal as="section" className="block" delay={0.08}>
          <header className="block-head">
            <div className="block-title">
              <h2>{focused ? `${focused.name} leaders` : "Organization leaders"}</h2>
              <p>Members with the most tokens in range</p>
            </div>
            {selectedTeam && (
              <button className="text-button" type="button" onClick={() => onSelectTeam(null)}>
                <Filter size={13} aria-hidden="true" /> Show every team
              </button>
            )}
          </header>
          {leaders.length ? (
            <ol className="leader">
              {leaders.map((member, index) => (
                <li key={member.user} style={{ "--team": `var(${tokenOf.get(member.team) ?? "--team-unassigned"})`, "--fill": member.tokens / leaderMax, "--i": index } as CSSProperties}>
                  <span className="rank">{index + 1}</span>
                  <button type="button" className="share-name" title={`Filter to ${member.user}`} onClick={() => onPickUser(member.user)}>
                    <Person name={member.user} hue={hues.get(member.user)} />
                  </button>
                  <span className="pill is-team" style={{ "--team": `var(${tokenOf.get(member.team) ?? "--team-unassigned"})` } as CSSProperties}>
                    {member.team}
                  </span>
                  <span className="num">{formatCompact(member.tokens)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <Empty>No member usage in this range.</Empty>
          )}
        </Reveal>
      </div>

      <Reveal as="section" className="block">
        <header className="block-head">
          <div className="block-title">
            <h2>{focused ? `${focused.name} members` : "All members"}</h2>
            <p>Calls, tokens and estimated cost per person, with their team</p>
          </div>
          <span className="muted">
            <span className="num">{formatCount(focused ? focused.members.length : memberCount)}</span> members ·{" "}
            <span className="num">{formatCount(liveUsers.length)}</span> live
          </span>
        </header>
        <MembersTable rows={rows} teams={teams} currency={currency} liveUsers={liveUsers} now={now} hues={hues} focusTeam={selectedTeam} onPickUser={onPickUser} />
      </Reveal>
    </>
  );
}
