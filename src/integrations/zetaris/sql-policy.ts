export type ZetarisSqlValidation =
  | { ok: true; sql: string }
  | { ok: false; reason: string };

const COLUMN = "(?:pokemon_name|ability_name|is_hidden)";
const COLUMNS = `(?:\\*|${COLUMN}(?:\\s*,\\s*${COLUMN})*)`;
const VALUE = "(?:'(?:[^']|'')*'|-?\\d+(?:\\.\\d+)?|true|false)";
const CONDITION = `${COLUMN}\\s*(?:=|<>|!=|<=|>=|<|>)\\s*${VALUE}`;

const SAFE_QUERY = new RegExp(
  "^\\s*SELECT\\s+" +
    COLUMNS +
    "\\s+FROM\\s+pokeapi\\.pikachu_abilities_table" +
    `(?:\\s+WHERE\\s+${CONDITION}(?:\\s+AND\\s+${CONDITION})*)?` +
    `(?:\\s+ORDER\\s+BY\\s+${COLUMN}(?:\\s+(?:ASC|DESC))?(?:\\s*,\\s*${COLUMN}(?:\\s+(?:ASC|DESC))?)*)?` +
    "(?:\\s+LIMIT\\s+(\\d+))?\\s*$",
  "i",
);

export function validateReadOnlyZetarisSql(
  input: unknown,
): ZetarisSqlValidation {
  if (typeof input !== "string" || !input.trim()) {
    return { ok: false, reason: "SQL must be a non-empty string." };
  }

  let sql = input.trim();

  if (sql.length > 2_000) {
    return { ok: false, reason: "SQL exceeds the 2,000-character limit." };
  }

  // Allow one optional trailing semicolon only.
  if (sql.endsWith(";")) sql = sql.slice(0, -1).trim();

  if (/[;]|--|\/\*|\*\/|#|\0/.test(sql)) {
    return {
      ok: false,
      reason: "Multiple statements, comments, and null characters are blocked.",
    };
  }

  const match = SAFE_QUERY.exec(sql);
  if (!match) {
    return {
      ok: false,
      reason:
        "Only a simple read-only SELECT on pokeapi.pikachu_abilities_table is allowed.",
    };
  }

  if (match[1] !== undefined) {
    const limit = Number(match[1]);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return {
        ok: false,
        reason: "SQL LIMIT must be between 1 and 100.",
      };
    }
  } else {
    sql += " LIMIT 100";
  }

  return { ok: true, sql };
}
