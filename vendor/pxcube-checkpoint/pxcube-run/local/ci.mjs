// Uses exactly the local packaging program; only the final artifact location differs.
import fs from 'node:fs';
import path from 'node:path';
import { build, root } from './run.mjs';
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--staged')) throw Error('Use: node local/ci.mjs [--staged <matrix-artifacts-directory>]');
const result = await build(root, { stagedRoot: args.length ? path.resolve(args[1]) : null });
fs.rmSync(path.join(root,'dist'), {recursive:true,force:true});
fs.cpSync(result.site, path.join(root,'dist'), {recursive:true});
// A partial build still has an inspectable site. A fatal assembly error never
// emits this output, so deployment cannot mistake an old dist for a new site.
if(process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'site-ready=true\n');
const failures=result.report.results.filter(app=>!app.ok);
if(process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,`PxCube attempt: ${result.report.runId}\n\n${result.report.results.map(app=>`- ${app.id}: ${app.ok?'packaged':'FAILED'}${app.drift?' · registration drift':''}`).join('\n')}\n`);
if(failures.length) process.exitCode=1; // Keep the run red while publishing healthy siblings.
