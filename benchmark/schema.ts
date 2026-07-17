// Benchmark record schema. This module is intentionally standalone and MUST
// NOT import from the extension bundle (src/): the benchmark lives outside the
// shipped extension and only depends on plain data.

export type BenchmarkLabel = "human" | "ai" | "hybrid";

export type BenchmarkTransformation =
  "none" | "humanized" | "translated" | "edited";

export interface BenchmarkRecord {
  id: string;
  text: string;
  label: BenchmarkLabel;
  authorGroup: string;
  createdAt: number;
  platform: string;
  language: string;
  topic: string;
  generatorModel?: string;
  transformation?: BenchmarkTransformation;
  license: string;
}

export class BenchmarkRecordError extends Error {
  readonly reason: string;
  readonly recordId?: string;

  constructor(reason: string, recordId?: string) {
    super(
      recordId === undefined
        ? `BENCHMARK_RECORD_INVALID: ${reason}`
        : `BENCHMARK_RECORD_INVALID: ${reason} (id=${recordId})`,
    );
    this.name = "BenchmarkRecordError";
    this.reason = reason;
    this.recordId = recordId;
  }
}

const LABELS: readonly BenchmarkLabel[] = ["human", "ai", "hybrid"];
const TRANSFORMATIONS: readonly BenchmarkTransformation[] = [
  "none",
  "humanized",
  "translated",
  "edited",
];

// Pseudonymised author groups are opaque tokens only: no whitespace and no
// email/PII separators such as "@" or ".", so raw names and addresses are
// rejected and grouping stays privacy preserving.
const PSEUDONYM = /^[A-Za-z0-9_-]+$/;

export function validateBenchmarkRecord(value: unknown): BenchmarkRecord {
  if (!isRecord(value)) {
    throw new BenchmarkRecordError("record is not an object");
  }

  const id = value.id;
  if (!isNonEmptyString(id)) {
    throw new BenchmarkRecordError("id must be a non-empty string");
  }

  const text = value.text;
  if (!isNonEmptyString(text)) {
    throw new BenchmarkRecordError("text must be a non-empty string", id);
  }

  const label = value.label;
  if (!isLabel(label)) {
    throw new BenchmarkRecordError(
      `label must be one of ${LABELS.join(", ")}`,
      id,
    );
  }

  const authorGroup = value.authorGroup;
  if (!isNonEmptyString(authorGroup) || !PSEUDONYM.test(authorGroup)) {
    throw new BenchmarkRecordError(
      "authorGroup must be a pseudonymised token matching [A-Za-z0-9_-], never raw PII",
      id,
    );
  }

  const createdAt = value.createdAt;
  if (!isFiniteNumber(createdAt)) {
    throw new BenchmarkRecordError("createdAt must be a finite number", id);
  }

  const platform = value.platform;
  if (!isNonEmptyString(platform)) {
    throw new BenchmarkRecordError("platform must be a non-empty string", id);
  }

  const language = value.language;
  if (!isNonEmptyString(language)) {
    throw new BenchmarkRecordError("language must be a non-empty string", id);
  }

  const topic = value.topic;
  if (!isNonEmptyString(topic)) {
    throw new BenchmarkRecordError("topic must be a non-empty string", id);
  }

  const license = value.license;
  if (!isNonEmptyString(license)) {
    throw new BenchmarkRecordError(
      "license is required so datasets stay auditable",
      id,
    );
  }

  const record: BenchmarkRecord = {
    id,
    text,
    label,
    authorGroup,
    createdAt,
    platform,
    language,
    topic,
    license,
  };

  const generatorModel = value.generatorModel;
  if (generatorModel !== undefined) {
    if (!isNonEmptyString(generatorModel)) {
      throw new BenchmarkRecordError(
        "generatorModel must be a non-empty string when present",
        id,
      );
    }
    record.generatorModel = generatorModel;
  }

  const transformation = value.transformation;
  if (transformation !== undefined) {
    if (!isTransformation(transformation)) {
      throw new BenchmarkRecordError(
        `transformation must be one of ${TRANSFORMATIONS.join(", ")} when present`,
        id,
      );
    }
    record.transformation = transformation;
  }

  return record;
}

// Parses a JSONL dataset, validating every record. Datasets never enter Git
// (see .gitignore), so this only runs against local files supplied at runtime.
export function parseBenchmarkDataset(jsonl: string): BenchmarkRecord[] {
  const records: BenchmarkRecord[] = [];
  jsonl.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed === "") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new BenchmarkRecordError(`line ${index + 1} is not valid JSON`);
    }
    records.push(validateBenchmarkRecord(parsed));
  });
  return records;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isLabel(value: unknown): value is BenchmarkLabel {
  return typeof value === "string" && LABELS.includes(value as BenchmarkLabel);
}

function isTransformation(value: unknown): value is BenchmarkTransformation {
  return (
    typeof value === "string" &&
    TRANSFORMATIONS.includes(value as BenchmarkTransformation)
  );
}
