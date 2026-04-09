# LLM Wiki Workflow

This file defines the operating workflow for `cortana-external` research topics.

It is the explicit process behind the markdown-first knowledge system:

- `research/raw/` = source corpus
- `research/derived/` = synthesized working layer
- `knowledge/` = compiled current truth

## Agent Read Order

When an LLM needs to answer or act on a product/runtime topic:

1. read `knowledge/` first for current truth
2. read `research/derived/` second for evidence and nuance
3. read `research/raw/` last when source inspection is needed

Do not start from raw research if the answer already exists in `knowledge/`.

## New Source Intake

When a new PDF, article, or source document arrives:

1. place it in `research/raw/<topic>/`
2. keep it in source form when possible
3. if it is a PDF corpus, place it in `research/raw/<topic>/pdfs/`
4. if the filename is poor, use the real title from the document when indexing it

Examples:

- backtester research -> `research/raw/backtester/`
- Mission Control research -> `research/raw/mission-control/`

## Raw-Layer Update Rules

After adding new source material:

1. update or create a raw topic README
2. update the topic inventory/index file if the corpus is large enough to need one
3. normalize titles so future LLM passes do not depend on messy filenames
4. group the source into one or more topic buckets

## Bucketing Rule

Classify new material by subject, not by source or date alone.

Typical `cortana-external` buckets include:

- backtester
- mission-control
- integrations
- provider/runtime behavior
- trading logic

If a source fits multiple buckets, reference it in all relevant derived summaries instead of duplicating the raw file.

## Derived-Layer Workflow

Once raw intake is updated:

1. read the new source
2. decide which derived topic files it affects
3. add paper-level notes or synthesis to the matching files in `research/derived/<topic>/`
4. update any topic evidence map or summary page if the new source changes the evidence shape
5. keep derived docs as synthesis, not as final policy

Derived docs should answer:

- what the evidence says
- how strong it is
- what it implies for the system
- what still looks uncertain

## Promotion Gate

Promote from `research/derived/` into `knowledge/` only when the conclusion is:

- durable
- repeated across multiple sources or otherwise high-confidence
- operationally useful
- specific enough to change current truth

Promote into source docs instead when the output becomes:

- a PRD or design decision
- a runbook
- an architecture note
- a durable operator guide

## Promotion Targets In `cortana-external`

Typical promotion targets are:

- `knowledge/domains/...`
- `knowledge/indexes/...`
- `docs/source/...`
- `apps/<app>/docs/source/...`
- `backtester/docs/source/...`

Use the narrowest owner:

- Mission Control truth -> `apps/mission-control/...` or matching `knowledge/`
- backtester truth -> `backtester/...`
- repo-wide truth -> top-level `docs/` or `knowledge/`

## When Not To Promote

Do not promote when:

- the source is interesting but not durable
- the evidence is still mixed
- the conclusion is too vague to affect behavior
- the note is only useful as a temporary comparison or scratch synthesis

In that case, keep it in `research/derived/`.

## End-To-End Example

When a new backtester paper arrives:

1. drop it into `research/raw/backtester/`
2. update the raw topic index if needed
3. classify it into the right bucket(s)
4. update the matching `research/derived/backtester/...` synthesis docs
5. if it changes stable system truth, update `knowledge/domains/backtester/`
6. if it changes planning or operations, update `backtester/docs/source/...`

## Final Rule

The LLM should rarely write straight into `knowledge/` from a brand-new source.

The normal flow is:

`raw -> derived -> knowledge`

That is the main discipline that keeps the wiki trustworthy.
