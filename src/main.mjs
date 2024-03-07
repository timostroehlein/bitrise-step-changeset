#!/usr/bin/env zx
/**
 * Source code mostly taken from official changeset github action:
 * https://github.com/changesets/action
 * Packages need to be imported at the beginning, otherwise they won't get installed.
 */
import "zx/globals";
import "semver";
import "unified";
import "resolve-from";
import "remark-parse";
import "remark-stringify";
import "mdast-util-to-string";
import "@changesets/pre";
import "@changesets/read";
import { getPackages } from "@manypkg/get-packages";
import { runPublish, runVersion } from "./run.mjs";
import { readChangesetState } from "./readChangesetState.mjs";
// @ts-check

console.log(process.env.example_step_input);

const { rootDir } = await getPackages(`${process.cwd()}/../`); // TODO: change
console.log(rootDir);
let { changesets } = await readChangesetState(rootDir);

let publishScript = ""; // TODO: replace with bitrise input
let hasChangesets = changesets.length !== 0;
const hasNonEmptyChangesets = changesets.some(
  (changeset) => changeset.releases.length > 0
);
let hasPublishScript = !!publishScript;

// core.setOutput("published", "false");
// core.setOutput("publishedPackages", "[]");
// core.setOutput("hasChangesets", String(hasChangesets));

switch (true) {
  case !hasChangesets && !hasPublishScript:
    console.info("No changesets found");
    break;
  case !hasChangesets && hasPublishScript: {
    console.info(
      "No changesets found, attempting to publish any unpublished packages to npm"
    );

    let userNpmrcPath = `${process.env.HOME}/.npmrc`;
    if (fs.existsSync(userNpmrcPath)) {
      console.info("Found existing user .npmrc file");
      const userNpmrcContent = await fs.readFile(userNpmrcPath, "utf8");
      const authLine = userNpmrcContent.split("\n").find((line) => {
        // check based on https://github.com/npm/cli/blob/8f8f71e4dd5ee66b3b17888faad5a7bf6c657eed/test/lib/adduser.js#L103-L105
        return /^\s*\/\/registry\.npmjs\.org\/:[_-]authToken=/i.test(line);
      });
      if (authLine) {
        console.info(
          "Found existing auth token for the npm registry in the user .npmrc file"
        );
      } else {
        console.info(
          "Didn't find existing auth token for the npm registry in the user .npmrc file, creating one"
        );
        fs.appendFileSync(
          userNpmrcPath,
          `\n//registry.npmjs.org/:_authToken=${process.env.NPM_TOKEN}\n`
        );
      }
    } else {
      console.info("No user .npmrc file found, creating one");
      fs.writeFileSync(
        userNpmrcPath,
        `//registry.npmjs.org/:_authToken=${process.env.NPM_TOKEN}\n`
      );
    }

    const result = await runPublish({
      script: publishScript,
      githubToken: "",
      // createGithubReleases: core.getBooleanInput("createGithubReleases"),
    });

    if (result.published) {
      // core.setOutput("published", "true");
      // core.setOutput(
      //   "publishedPackages",
      //   JSON.stringify(result.publishedPackages)
      // );
    }
    break;
  }
  case hasChangesets && !hasNonEmptyChangesets:
    console.info("All changesets are empty; not creating PR");
    break;
  case hasChangesets:
    const { pullRequestNumber } = await runVersion({
      cwd: rootDir,
      // script: getOptionalInput("version"),
      githubToken: "",
      // prTitle: getOptionalInput("title"),
      // commitMessage: getOptionalInput("commit"),
      hasPublishScript,
    });

    // core.setOutput("pullRequestNumber", String(pullRequestNumber));
    break;
}
