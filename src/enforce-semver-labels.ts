import { Application } from 'probot';
import { SEMVER_LABELS } from './constants';

const ALL_SEMVER_LABELS = [SEMVER_LABELS.MAJOR, SEMVER_LABELS.MINOR, SEMVER_LABELS.PATCH];

export function setupSemverLabelEnforcement(probot: Application) {
  probot.on(
    ['pull_request.opened', 'pull_request.unlabeled', 'pull_request.labeled'],
    async context => {
      const pr = context.payload.pull_request;

      probot.log(
        'semver-enforce received PR:',
        `${context.payload.repository.full_name}#${pr.number}`,
        'checking now',
      );

      const semverLabels = pr.labels.filter((l: any) => ALL_SEMVER_LABELS.includes(l.name));
      if (semverLabels.length === 0) {
        // Pending check -- not enough
        await context.github.checks.create(
          context.repo({
            name: 'Semver Label Enforcement',
            head_sha: pr.head.sha,
            status: 'in_progress',
            output: {
              title: 'No semver/* label found',
              summary: "We couldn't find a semver/* label, please add one",
            },
          }),
        );
      } else if (semverLabels.length > 1) {
        // Pending check -- too many
        await context.github.checks.create(
          context.repo({
            name: 'Semver Label Enforcement',
            head_sha: pr.head.sha,
            status: 'in_progress',
            output: {
              title: 'Multiple semver/* labels found',
              summary: 'We found multiple semver/* labels, please remove one',
            },
          }),
        );
      } else {
        // Pass check
        await context.github.checks.create(
          context.repo({
            name: 'Semver Label Enforcement',
            head_sha: pr.head.sha,
            status: 'completed',
            conclusion: 'success',
            output: {
              title: `Found "${semverLabels[0].name}"`,
              summary: 'Found a single semver/* label, looking good here.',
            },
          }),
        );
      }
    },
  );
}