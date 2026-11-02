import { isUnknownUser, type UsageRow } from "./usage";

export type TeamData = {
  demo: boolean;
  organization: string;
  names: string[];
  assignments: Record<string, string>;
};

export const UNASSIGNED = "Unassigned";
export const DEFAULT_ORGANIZATION = "tth-cto-innovation";

const TEAM_TOKENS: Record<string, string> = {
  Data: "--team-data",
  AI: "--team-ai",
  "Cognitive core": "--team-cognitive",
  "Rapid labs": "--team-rapid",
  Innovation: "--team-innovation",
  [UNASSIGNED]: "--team-unassigned",
};
const FALLBACK_TOKENS = ["--c-calls", "--c-tokens", "--c-rose", "--c-sun", "--c-lime", "--c-sky", "--c-cost"];

/** The CSS custom property that carries a team's hue in both themes. */
export function teamToken(name: string, index = 0) {
  return TEAM_TOKENS[name] ?? FALLBACK_TOKENS[index % FALLBACK_TOKENS.length];
}

export function teamColor(name: string, index = 0) {
  return `var(${teamToken(name, index)})`;
}

export function isTeamData(value: unknown): value is TeamData {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<TeamData>;
  if (!Array.isArray(data.names) || !data.names.every((name) => typeof name === "string")) return false;
  if (!data.assignments || typeof data.assignments !== "object" || Array.isArray(data.assignments)) return false;
  const names = new Set(data.names);
  return Object.entries(data.assignments).every(([user, team]) => user.trim() && typeof team === "string" && names.has(team));
}

export function normalizeTeams(value: unknown): TeamData | null {
  if (!isTeamData(value)) return null;
  return {
    demo: value.demo !== false,
    organization: typeof value.organization === "string" && value.organization.trim() ? value.organization : DEFAULT_ORGANIZATION,
    names: value.names,
    assignments: value.assignments,
  };
}

export function teamOf(user: string, teams: TeamData | null) {
  return teams && Object.hasOwn(teams.assignments, user) ? teams.assignments[user] : UNASSIGNED;
}

export type TeamMember = {
  user: string;
  team: string;
  requests: number;
  input: number;
  output: number;
  tokens: number;
  cost: number;
};

export type TeamSummary = {
  name: string;
  token: string;
  /** Every saved member, including people with no usage in the current filters. */
  members: TeamMember[];
  activeMembers: number;
  requests: number;
  input: number;
  output: number;
  tokens: number;
  cost: number;
  /** Share of all filtered tokens. */
  share: number;
  /** Calls per day, aligned with the `days` argument. */
  daily: number[];
};

/**
 * Rolls filtered usage up into the organization's teams. Usage from people without a saved
 * membership (for example `unknown`) lands in an Unassigned group so team totals reconcile.
 */
export function summarizeTeams(rows: UsageRow[], teams: TeamData, days: string[]) {
  const dayIndex = new Map(days.map((day, position) => [day, position]));
  const people = new Map<string, TeamMember>();
  const daily = new Map<string, number[]>();
  const ensureTeam = (name: string) => {
    if (!daily.has(name)) daily.set(name, days.map(() => 0));
    return daily.get(name)!;
  };
  for (const [user, team] of Object.entries(teams.assignments)) {
    people.set(user, { user, team, requests: 0, input: 0, output: 0, tokens: 0, cost: 0 });
  }
  for (const row of rows) {
    const team = teamOf(row.user, teams);
    const person = people.get(row.user) ?? { user: row.user, team, requests: 0, input: 0, output: 0, tokens: 0, cost: 0 };
    person.requests += row.requests;
    person.input += row.input_tokens;
    person.output += row.output_tokens;
    person.tokens += row.input_tokens + row.output_tokens;
    person.cost += row.cost;
    people.set(row.user, person);
    const position = dayIndex.get(row.date);
    if (position !== undefined) ensureTeam(team)[position] += row.requests;
  }
  const allTokens = [...people.values()].reduce((sum, person) => sum + person.tokens, 0);
  const names = [...teams.names];
  if ([...people.values()].some((person) => person.team === UNASSIGNED && person.requests > 0)) names.push(UNASSIGNED);

  const summaries: TeamSummary[] = names.map((name, index) => {
    const members = [...people.values()]
      .filter((person) => person.team === name && (name !== UNASSIGNED || person.requests > 0))
      .sort((a, b) => b.tokens - a.tokens || a.user.localeCompare(b.user));
    const sum = (pick: (member: TeamMember) => number) => members.reduce((total, member) => total + pick(member), 0);
    const tokens = sum((member) => member.tokens);
    return {
      name,
      token: teamToken(name, index),
      members,
      activeMembers: members.filter((member) => member.requests > 0 && !isUnknownUser(member.user)).length,
      requests: sum((member) => member.requests),
      input: sum((member) => member.input),
      output: sum((member) => member.output),
      tokens,
      cost: sum((member) => member.cost),
      share: allTokens ? (tokens / allTokens) * 100 : 0,
      daily: daily.get(name) ?? days.map(() => 0),
    };
  });
  return summaries;
}
