// Build a commit, or the working tree, with the configured command and keep
// a copy of the configured output. A commit is checked out as a detached git
// worktree, so builds that call git still work.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function git(repo, args, { quiet = false } = {}) {
  const run = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  if (run.status !== 0) {
    if (quiet) return null;
    throw Error(`git ${args.join(' ')} failed: ${run.stderr.trim()}`);
  }
  return run.stdout.trim();
}

export function resolveCommit(repo, ref) {
  return git(repo, ['rev-parse', '--verify', `${ref}^{commit}`]);
}

export class Builder {
  constructor(repo, config, scratch) {
    this.repo = repo;
    this.config = config;
    this.scratch = scratch;
    this.trees = new Map();
    this.outputs = new Map();
    fs.mkdirSync(scratch, { recursive: true });
  }

  tree(ref) {
    const sha = resolveCommit(this.repo, ref);
    if (!this.trees.has(sha)) {
      const dir = path.join(this.scratch, `tree-${sha.slice(0, 12)}`);
      if (!fs.existsSync(dir)) git(this.repo, ['worktree', 'add', '--detach', '--quiet', dir, sha]);
      this.trees.set(sha, dir);
    }
    return { sha, dir: this.trees.get(sha) };
  }

  // side: a label for logs and for the build's scratch directory.
  output(treeDir, side) {
    if (this.outputs.has(treeDir)) return this.outputs.get(treeDir);
    const cwd = path.join(treeDir, this.config.workingDirectory);
    const sideScratch = path.join(this.scratch, `build-${side}`);
    fs.mkdirSync(sideScratch, { recursive: true });
    console.error(`[called-shots] building ${side}: (cd ${path.relative(this.repo, cwd) || '.'} && ${this.config.build})`);
    const run = spawnSync('bash', ['-c', this.config.build], {
      cwd, stdio: ['ignore', 2, 2], // build logs go to stderr; stdout carries only the report
      env: { ...process.env, CALLED_SHOTS_SIDE: side, CALLED_SHOTS_SCRATCH: sideScratch },
    });
    if (run.error || run.status !== 0) throw Error(`build of ${side} failed (exit ${run.status ?? run.error?.message})`);
    const copy = this.keep(path.join(cwd, this.config.output), side);
    this.outputs.set(treeDir, copy);
    return copy;
  }

  // An output built elsewhere, for example by an earlier workflow step.
  keep(outputPath, side) {
    if (!fs.existsSync(outputPath)) throw Error(`output ${outputPath} does not exist after building ${side}`);
    const copy = path.join(this.scratch, `output-${side}`);
    fs.rmSync(copy, { recursive: true, force: true });
    fs.cpSync(fs.realpathSync(outputPath), copy, { recursive: true, dereference: true });
    return copy;
  }

  close() {
    for (const dir of this.trees.values()) git(this.repo, ['worktree', 'remove', '--force', dir], { quiet: true });
    git(this.repo, ['worktree', 'prune'], { quiet: true });
  }
}
