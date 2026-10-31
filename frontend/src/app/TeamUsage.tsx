import "./teams-view.css";

export type TeamData = {
  demo: true;
  names: string[];
  assignments: Record<string, string>;
};

type TeamUsageRow = {
  user: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  cost: number;
};

export function isTeamData(data: unknown): data is TeamData {
  if (!data || typeof data !== "object" || !("demo" in data) || data.demo !== true
    || !("names" in data) || !Array.isArray(data.names) || !data.names.length
    || !data.names.every((name) => typeof name === "string")
    || !("assignments" in data) || !data.assignments || typeof data.assignments !== "object"
    || Array.isArray(data.assignments)) return false;
  const names: string[] = data.names;
  return Object.entries(data.assignments).every(([user, team]) =>
    user.trim() && typeof team === "string" && names.includes(team),
  );
}

export function getUserTeam(user: string, teams: TeamData | null) {
  return teams && Object.hasOwn(teams.assignments, user) ? teams.assignments[user] : "Unassigned";
}

export function buildTeamRows(rows: TeamUsageRow[], teams: TeamData) {
  const names = [...teams.names];
  if (rows.some((row) => getUserTeam(row.user, teams) === "Unassigned")) names.push("Unassigned");
  return names.map((team) => {
    const members = Object.keys(teams.assignments).filter((user) => teams.assignments[user] === team).sort();
    const usage = rows.filter((row) => getUserTeam(row.user, teams) === team);
    return {
      team,
      members,
      active_users: new Set(usage.filter((row) => row.requests > 0 && row.user.toLowerCase() !== "unknown").map((row) => row.user)).size,
      requests: usage.reduce((sum, row) => sum + row.requests, 0),
      input_tokens: usage.reduce((sum, row) => sum + row.input_tokens, 0),
      output_tokens: usage.reduce((sum, row) => sum + row.output_tokens, 0),
      total_tokens: usage.reduce((sum, row) => sum + row.input_tokens + row.output_tokens, 0),
      cost: usage.reduce((sum, row) => sum + row.cost, 0),
    };
  });
}

export default function TeamUsage({
  rows, teams, selectedTeam, currency, onSelect,
}: {
  rows: TeamUsageRow[];
  teams: TeamData;
  selectedTeam: string;
  currency: string;
  onSelect: (team: string) => void;
}) {
  const counts = new Intl.NumberFormat("en-US");
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency });
  const teamRows = buildTeamRows(rows, teams).filter((row) => selectedTeam === "all" || row.team === selectedTeam);
  if (!teamRows.length) return <div className="empty-state">No team usage in this date range.</div>;
  return (
    <div className="team-usage-grid">
      {teamRows.map((team) => (
        <article className="team-usage-card" key={team.team}>
          <div className="team-usage-heading"><h3>{team.team}</h3><span>{team.active_users} active users</span></div>
          <div className="team-usage-total"><strong>{counts.format(team.total_tokens)}</strong><span>total tokens</span></div>
          <dl className="team-usage-metrics">
            <div><dt>Agent calls</dt><dd>{counts.format(team.requests)}</dd></div>
            <div><dt>Input tokens</dt><dd>{counts.format(team.input_tokens)}</dd></div>
            <div><dt>Output tokens</dt><dd>{counts.format(team.output_tokens)}</dd></div>
            <div><dt>Estimated cost</dt><dd>{money.format(team.cost)}</dd></div>
          </dl>
          {team.members.length > 0 ? (
            <details className="team-usage-members"><summary>{team.members.length} assigned people</summary><ul>{team.members.map((member) => <li key={member}>{member}</li>)}</ul></details>
          ) : <p className="team-usage-note">{team.team === "Unassigned" ? "Usage without an assigned identity." : "No assigned people yet."}</p>}
          <button type="button" className="text-link" onClick={() => onSelect(team.team)}>View {team.team} users</button>
        </article>
      ))}
    </div>
  );
}
