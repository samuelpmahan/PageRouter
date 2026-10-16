// Generated from D:/t-t-1/packages/cli/src/args.ts by tools/emit-pagerouter.mjs. Edit the TypeScript source.
// The shared `--key value` reader for flick.ts, match.ts and tournament.ts.
//
// Command-line tools, not browser code, so this sits beside them and not in exp/kernel.
//
//   const flag = flagReader(process.argv.slice(2));
//   flag('seed', 'demo')
//
// flag(key, fallback) answers from the argv array flagReader was given:
//
//   argv                             flag('seed', 'demo')   why
//   ['--seed', '7']                  '7'                    the token after the first exact '--seed'
//   []                               'demo'                 '--seed' is absent
//   ['--seed']                       'demo'                 '--seed' is the last token: nothing follows it
//   ['--seed', '']                   ''                     an empty string is a value, not a missing one
//   ['--seed', '--rules', 'a=1']     '--rules'              the next token is taken whatever it looks like
//   ['--seed', '-5']                 '-5'                   likewise a value that starts with '-'
//   ['--seed=7']                     'demo'                 '--key=value' is not recognised
//   ['--seed', '1', '--seed', '2']   '1'                    the first '--seed' wins
//   ['--seeds', '9']                 'demo'                 the token must equal '--seed' exactly
//   ['--', '--seed', '7']            '7'                    '--' does not end option parsing
//
// node:util parseArgs differs from this in four ways: it reads '--seed=7'; the last repeat wins; '--'
// ends options; and it throws on a missing value or a value that looks like an option. On `--key value`
// with each key at most once the two agree. exp/policybench/cli-args.test.mjs pins the agreement and
// each difference.
//
// flagReader keeps the array it is given and reads it on every call, so tokens pushed later are seen.
export function flagReader(args) {
    return (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? (args[i + 1] ?? d) : d; };
}
