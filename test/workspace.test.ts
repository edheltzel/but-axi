import { describe, expect, it } from "vitest";
import { aggregate, mapState, summarize, workspaceBlock } from "../src/workspace.js";
import { render } from "../src/format.js";

const RAW = {
  uncommittedChanges: [{ cliId: "yz", filePath: "a.txt", changeType: "added" }],
  stacks: [
    {
      cliId: "n0",
      assignedChanges: [],
      branches: [
        {
          cliId: "fi",
          name: "fix/a",
          commits: [
            { cliId: "rmo", changeId: "rmoqvv", commitId: "8bb7189fc4763408", message: "fix: one\n\nbody", authorName: "Ed", conflicted: false },
            { cliId: "wqy", changeId: "wqyvwy", commitId: "9a8d47d444588", message: "fix: two", authorName: "Ed", conflicted: true },
          ],
          upstreamCommits: [],
          branchStatus: "completelyUnpushed",
          reviewId: null,
        },
        { cliId: "ix", name: "fix/b", commits: [], upstreamCommits: [], branchStatus: "nothingToPush", reviewId: 12 },
      ],
    },
  ],
  mergeBase: { commitId: "6880f86d2d11e5", message: "Merge branch 'readme'" },
  upstreamState: { behind: 2 },
};

describe("summarize", () => {
  const ws = summarize(RAW, "/r", "/r");
  it("flattens branches and commits with mapped state", () => {
    expect(ws.branches.map((b) => [b.name, b.commits, b.state, b.conflicts, b.review])).toEqual([
      ["fix/a", 2, "unpushed", 1, ""],
      ["fix/b", 0, "pushed", 0, "12"],
    ]);
    expect(ws.commits[0]).toMatchObject({ id: "rmo", sha: "8bb7189", branch: "fix/a", subject: "fix: one" });
    expect(ws.conflicts).toBe(1);
    expect(ws.behind).toBe(2);
  });
  it("aggregates counts up front", () => {
    expect(aggregate(ws)).toBe("1 stack; 2 branches; 2 commits (2 on unpushed branches); 1 uncommitted; 1 conflict");
  });
  it("renders the workspace block as TOON", () => {
    const out = render({ data: workspaceBlock(ws, {}) });
    expect(out).toContain("branches[2]{name,commits,state}:\n  fix/a,2,unpushed\n  fix/b,0,pushed");
    expect(out).toContain("upstream: behind 2");
  });
  it("empty workspace is explicit", () => {
    const e = summarize({ uncommittedChanges: [], stacks: [] }, "/r", "/r");
    expect(render({ data: workspaceBlock(e, {}) })).toContain("branches: 0 applied branches");
    expect(aggregate(e)).toBe("0 stacks; 0 branches; 0 commits; 0 uncommitted; 0 conflicts");
  });
  it("mapState passes unknown values through", () => {
    expect(mapState("weird")).toBe("weird");
  });
});
