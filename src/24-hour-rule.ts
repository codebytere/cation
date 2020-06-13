import { Application } from 'probot';

import {
  NEW_PR_LABEL,
  MINIMUM_OPEN_TIME,
  EXCLUDE_LABELS,
  EXCLUDE_PREFIXES,
  EXCLUDE_USERS,
} from './constants';
import { WebhookPayloadWithRepository, Context } from 'probot/lib/context';

const CHECK_INTERVAL = 1000 * 60 * 5;

export function setUp24HourRule(probot: Application) {
  const shouldPRHaveLabel = (pr: WebhookPayloadWithRepository['pull_request']): boolean => {
    const prefix = pr.title.split(':')[0];
    const backportMatch = pr.title.match(/[bB]ackport/);
    const backportInTitle = backportMatch && backportMatch[0];
    const hasExcludedLabel = pr.labels.some((l: any) => {
      return EXCLUDE_LABELS.includes(l.name) && prefix !== 'feat';
    });

    if (
      EXCLUDE_PREFIXES.includes(prefix) ||
      hasExcludedLabel ||
      backportInTitle ||
      EXCLUDE_USERS.includes(pr.user.login)
    )
      return false;

    const created = new Date(pr.created_at).getTime();
    const now = Date.now();

    return now - created < MINIMUM_OPEN_TIME;
  };

  const applyLabelToPR = async (
    github: Context['github'],
    pr: WebhookPayloadWithRepository['pull_request'],
    repoOwner: string,
    repoName: string,
    shouldHaveLabel: boolean,
  ) => {
    if (shouldHaveLabel) {
      probot.log('Found PR:', `${repoOwner}/${repoName}#${pr.number}`, 'should add label.');
      await github.issues.addLabels({
        number: pr.number,
        labels: [NEW_PR_LABEL],
        repo: repoName,
        owner: repoOwner,
      });
    } else {
      probot.log('Found PR:', `${repoOwner}/${repoName}#${pr.number}`, 'should remove label.');

      try {
        await github.issues.removeLabel({
          owner: repoOwner,
          repo: repoName,
          number: pr.number,
          name: NEW_PR_LABEL,
        });
      } catch {
        // Ignore the error here, it's a race condition between the Cron jobb and GitHub webhooks
      }
    }
  };

  probot.on(['pull_request.opened', 'pull_request.unlabeled'], async context => {
    const pr = context.payload.pull_request;

    probot.log(
      'received PR:',
      `${context.payload.repository.full_name}#${pr.number}`,
      'checking now',
    );

    await applyLabelToPR(
      context.github,
      pr,
      context.repo({}).owner,
      context.repo({}).repo,
      shouldPRHaveLabel(pr),
    );
  });

  runInterval();

  async function runInterval() {
    probot.log('Running 24 hour rule check');
    const github = await probot.auth();
    const { data: installs } = await github.apps.listInstallations({});
    for (const install of installs) {
      try {
        await runCron(probot, install.id);
      } catch (err) {
        probot.log('Failed to run cron for install:', install.id, err);
      }
    }

    setTimeout(runInterval, CHECK_INTERVAL);
  }

  async function runCron(probot: Application, installId: number) {
    const github = await probot.auth(installId);
    const repos = await github.apps.listRepos({});

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 1);
    const cutoffStr = cutoff.toISOString();

    // remove NEW_PR_LABEL from old PRs
    for (const repo of repos.data.repositories) {
      const q = [
        `repo:${repo.owner.login}/${repo.name}`,
        'is:pr',
        `-label:${NEW_PR_LABEL}`,
        `created:<=${cutoffStr}`,
      ].join('+');
      const prs = await github.search.issues({ q });
      for (const pr of prs) {
        await applyLabelToPR(github, pr, repo.owner.login, repo.name, false);
      }
    }

    // add NEW_PR_LABEL to new PRs
    for (const repo of repos.data.repositories) {
      const q = [
        `repo:${repo.owner.login}/${repo.name}`,
        'is:pr',
        `created:>${cutoffStr}`,
        `label:${NEW_PR_LABEL}`,
      ].join('+');
      const prs = await github.search.issues({ q });
      for (const pr of prs) {
        await applyLabelToPR(github, pr, repo.owner.login, repo.name, true);
      }
    }
  }
}
