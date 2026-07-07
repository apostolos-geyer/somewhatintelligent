<!--
TITLE FORMAT (enforced by CI — pr-title-lint):

    type(scope): description        e.g.  fix(sprout): hero image aspect ratio
    types: feat fix chore docs refactor perf test ci build revert

Squash merges turn the PR title into the main-branch commit message.
release-please versions each worker from those messages — an unparseable
title means this PR contributes NOTHING to any worker's next release.
Scope with the worker you touched (sprout, guestlist, roadie, …) when the
change belongs to one; feat/fix decide minor/patch bumps.
-->

## What

<!-- one or two sentences: the change and why -->

## Verification

<!-- how this was proven: tests run, lanes exercised, URLs checked -->
