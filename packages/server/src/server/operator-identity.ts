import path from "node:path";
import type { MutableDaemonConfig, TeamMemberProfile } from "@getpaseo/protocol/messages";

export type OperatorEnvironment = Record<string, string>;

export function resolveTeamMember(
  config: Pick<MutableDaemonConfig, "teamMembers">,
  operatorId: string | null | undefined,
): TeamMemberProfile | null {
  const id = operatorId?.trim();
  if (!id) return null;
  return config.teamMembers?.find((member) => member.id === id) ?? null;
}

export function resolveOperatorGitEnvironment(
  member: TeamMemberProfile | null,
): OperatorEnvironment {
  if (!member?.git) return {};
  return {
    GIT_AUTHOR_NAME: member.git.name,
    GIT_AUTHOR_EMAIL: member.git.email,
    GIT_COMMITTER_NAME: member.git.name,
    GIT_COMMITTER_EMAIL: member.git.email,
  };
}

export function resolveOperatorGitHubEnvironment(
  paseoHome: string,
  member: TeamMemberProfile | null,
): OperatorEnvironment {
  if (!member) return {};
  return {
    GH_CONFIG_DIR: path.join(paseoHome, "operator-credentials", member.id, "gh"),
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "credential.helper",
    GIT_CONFIG_VALUE_0: "!gh auth git-credential",
  };
}

export function appendRequestedBy(body: string, member: TeamMemberProfile | null): string {
  const trimmed = body.trim();
  if (!member) return trimmed;
  const attribution = `Requested by ${member.name}.`;
  if (trimmed.endsWith(attribution)) return trimmed;
  return trimmed ? `${trimmed}\n\n${attribution}` : attribution;
}
