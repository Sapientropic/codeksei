import { normalizeText } from "../core/text-normalization";
import { normalizeDisplayPath } from "../core/path-utils";
import { collectProjectRadars } from "../workspace/project-radar";
import type { WorkspaceContinuityFile } from "../workspace/workspace-bootstrap";
import type { ContextBoardConfig, ProjectRadarSnapshot } from "./board";

type CollectedProjectRadar = ReturnType<typeof collectProjectRadars>["projects"][number];

export function collectCurrentProjectRadar(
  config: Pick<ContextBoardConfig, "projectRadarConfigFile" | "workspaceRoot">,
  workspaceRoot: string,
): ProjectRadarSnapshot {
  try {
    const result = collectProjectRadars(config, {});
    const normalizedWorkspaceRoot = normalizeDisplayPath(workspaceRoot);
    const matched = result.projects.find((project) => (
      normalizeDisplayPath(project.repoRoot) === normalizedWorkspaceRoot
    )) || (result.projects.length === 1 ? result.projects[0] : null);
    if (!matched) {
      const candidates = rankTrackedProjectCandidates(result.projects).slice(0, 3);
      if (candidates.length) {
        return buildTrackedProjectCandidatesSnapshot(candidates);
      }
      return {
        available: false,
        branch: "",
        dirty: false,
        matchedProject: "",
        notePath: "",
        readFirst: [],
        recentCommit: "",
        reason: "workspace_not_tracked",
      };
    }
    return {
      available: matched.git.ok,
      branch: normalizeText(matched.git.branch),
      dirty: Boolean(matched.git.dirty),
      matchedProject: normalizeText(matched.slug),
      notePath: normalizeText(matched.notePath),
      readFirst: matched.readFirst
        .filter(Boolean)
        .map((file) => ({
          absolutePath: normalizeText(file?.path),
          role: normalizeText(file?.kind) || "workspace note",
          when: "",
        }))
        .filter((file) => file.absolutePath),
      recentCommit: matched.git.recentCommits[0]
        ? `${normalizeText(matched.git.recentCommits[0].shortHash)} ${normalizeText(matched.git.recentCommits[0].subject)}`
        : "",
      reason: matched.git.ok ? "" : normalizeText(matched.git.reason) || normalizeText(matched.git.message),
    };
  } catch (error) {
    return {
      available: false,
      branch: "",
      dirty: false,
      matchedProject: "",
      notePath: "",
      readFirst: [],
      recentCommit: "",
      reason: error instanceof Error ? error.message : String(error || "unknown error"),
    };
  }
}

function buildTrackedProjectCandidatesSnapshot(projects: CollectedProjectRadar[]): ProjectRadarSnapshot {
  const best = projects[0];
  const firstRecentCommit = projects
    .map((project) => project.git.recentCommits[0])
    .find(Boolean);
  const readFirst = uniqueWorkspaceContinuityFiles(
    projects.flatMap((project) => project.readFirst)
      .filter(Boolean)
      .map((file) => ({
        absolutePath: normalizeText(file?.path),
        role: `${normalizeText(file?.kind) || "workspace note"} (${normalizeText(
          projects.find((project) => project.readFirst.includes(file))?.slug
        ) || "tracked project"})`,
        when: "",
      }))
  );
  const unavailableReasons = projects
    .filter((project) => !project.git.ok)
    .map((project) => `${project.slug}:${normalizeText(project.git.reason) || normalizeText(project.git.message)}`)
    .filter(Boolean);
  return {
    available: projects.some((project) => project.git.ok),
    branch: normalizeText(best?.git.branch),
    dirty: projects.some((project) => Boolean(project.git.dirty)),
    matchedProject: `tracked project candidates: ${projects.map((project) => project.slug).join(", ")}`,
    notePath: normalizeText(best?.notePath),
    readFirst,
    recentCommit: firstRecentCommit
      ? `${normalizeText(firstRecentCommit.shortHash)} ${normalizeText(firstRecentCommit.subject)}`
      : "",
    reason: projects.some((project) => project.git.ok)
      ? ""
      : unavailableReasons.join("; ") || "tracked_project_candidates_unavailable",
  };
}

function rankTrackedProjectCandidates(projects: CollectedProjectRadar[]): CollectedProjectRadar[] {
  return [...projects].sort((left, right) => {
    const leftScore = scoreTrackedProjectCandidate(left);
    const rightScore = scoreTrackedProjectCandidate(right);
    if (leftScore !== rightScore) {
      return rightScore - leftScore;
    }
    return normalizeText(left.slug).localeCompare(normalizeText(right.slug));
  });
}

function scoreTrackedProjectCandidate(project: CollectedProjectRadar): number {
  return (project.git.ok ? 100 : 0)
    + (project.git.dirty ? 50 : 0)
    + (project.git.recentCommits.length ? 10 : 0)
    + (project.readFirst.length ? 1 : 0);
}

function uniqueWorkspaceContinuityFiles(files: WorkspaceContinuityFile[]): WorkspaceContinuityFile[] {
  const seen = new Set<string>();
  const unique: WorkspaceContinuityFile[] = [];
  for (const file of files) {
    const absolutePath = normalizeText(file.absolutePath);
    if (!absolutePath || seen.has(absolutePath)) {
      continue;
    }
    seen.add(absolutePath);
    unique.push({
      absolutePath,
      role: normalizeText(file.role),
      when: normalizeText(file.when),
    });
  }
  return unique.slice(0, 6);
}
