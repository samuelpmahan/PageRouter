# Crosscheck: does each sentence say only what its clauses check?

You are one of several checkers. You work alone: do not read any other
checker's answers, any `key.json`, `comparison.json` or `report.md`. Read only
the batch file you are given and this prompt.

## The batch

`batch.json` has `clauseKinds` (what each clause kind checks, exactly) and
`items`. Each item is one sentence from a called shot, and the clauses that
are meant to check it.

A shot is a change announced before it is built. The sentence is what a person
reads; the clauses are what a program checks after the build. The danger is a
sentence that promises more than its clauses check: the program reports the
shot as made, and the person believes the whole sentence.

## Your question, for every item

Is every claim in the sentence checked by at least one of the item's clauses,
read strictly by `clauseKinds`?

- `covered`: yes, every claim is checked.
- `gap`: at least one claim is not checked. Quote, verbatim, the words of the
  sentence that make the first unchecked claim in reading order. Copy them
  exactly from the sentence, as short as possible while still naming the claim.
  A quote that is not an exact substring of the sentence is discarded.

Read clauses literally. A clause that checks which files changed does not
check what the files contain or do. A file existing does not show that it
does what the sentence says it does. Explanations of why something happens
("because ...") are claims too.

Do not judge whether the change is good, or whether the shot was made.

## Your answer

Write one JSON file to the path you are given, and nothing else:

```json
{
  "format": "kompozed.shots.crosscheck-observation.v1",
  "checker": "<your checker name>",
  "case_id": "<case_id from batch.json>",
  "observables": {
    "<item id>": { "verdict": "covered", "unchecked": null },
    "<item id>": { "verdict": "gap", "unchecked": "<exact words from the sentence>" }
  }
}
```

Answer every item in the batch.
