#!/usr/bin/env zx
/**
 * Written using zx:
 * https://google.github.io/zx
 * Source code mostly taken from official changeset github action:
 * https://github.com/changesets/action
 * Packages need to be imported at the beginning, otherwise they won't get installed.
 */
import "zx";
import "semver";
import "unified";
import "resolve-from";
import "remark-parse";
import "remark-stringify";
import "mdast-util-to-string";
import "@changesets/pre";
import "@changesets/read";
import "@manypkg/get-packages";
import { findRoot } from "@manypkg/find-root";
import { runPublish, runVersion } from "./run.mjs";
import { readChangesetState } from "./readChangesetState.mjs";
// @ts-check

// Version
const shouldRunVersionScript = process.env.run_version;
const versionScript = process.env.version_script;
const versionCommitMessage = process.env.version_commit_message;
// Publish
const shouldRunPublishScript = process.env.run_publish;
const publishScript = process.env.publish_script;

// Check whether there are any changesets
const { rootDir } = await findRoot(process.cwd());
console.log(rootDir);
let { changesets } = await readChangesetState(rootDir);

let hasChangesets = changesets.length !== 0;
const hasNonEmptyChangesets = changesets.some(
  (changeset) => changeset.releases.length > 0
);

// Add output env variable
await $`envman add --key CHANGESET_EXISTS --value "${hasChangesets}"`;
await $`envman add --key CHANGESET_PUBLISHED --value "false"`;

switch (false) {
  case !hasChangesets && !shouldRunPublishScript:
    console.info("No changesets found");
    break;
  case !hasChangesets && shouldRunPublishScript: {
    console.info(
      "No changesets found, attempting to publish any unpublished packages to npm"
    );

    // Create .npmrc in user directory if it doesn't exist
    let userNpmrcPath = `${process.env.HOME}/.npmrc`;
    if (fs.existsSync(userNpmrcPath)) {
      console.info("Found existing user .npmrc file");
      const userNpmrcContent = await fs.readFile(userNpmrcPath, "utf8");
      const authLine = userNpmrcContent.split("\n").find((line) => {
        // Check based on https://github.com/npm/cli/blob/8f8f71e4dd5ee66b3b17888faad5a7bf6c657eed/test/lib/adduser.js#L103-L105
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

    // Publish changesets
    const result = await runPublish({
      cwd: rootDir,
      script: publishScript,
      // githubToken: "",
      // createGithubReleases: core.getBooleanInput("createGithubReleases"),
    });

    // Add output env variables
    if (result.published) {
      await $`envman add --key CHANGESET_PUBLISHED --value "true"`;
      await $`envman add --key CHANGESET_PUBLISHED_PACKAGES --value "${JSON.stringify(result.publishedPackages)}"`;
    }
    break;
  }
  case hasChangesets && !hasNonEmptyChangesets:
    console.info("All changesets are empty; not creating PR");
    break;
  case hasChangesets && shouldRunVersionScript:
    const { pullRequestNumber } = await runVersion({
      cwd: rootDir,
      script: versionScript,
      // githubToken: "",
      // prTitle: getOptionalInput("title"),
      commitMessage: versionCommitMessage,
      hasPublishScript: shouldRunPublishScript,
    });

    // core.setOutput("pullRequestNumber", String(pullRequestNumber));
    break;
}
