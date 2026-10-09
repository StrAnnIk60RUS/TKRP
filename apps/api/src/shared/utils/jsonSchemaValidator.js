/**
 * Minimal JSON-schema validator (dependency-free subset sufficient for LLM
 * output contracts): type (incl. type arrays), required, properties, items,
 * enum, minimum/maximum, minItems/maxItems, pattern, nullable via type arrays.
 *
 * Unknown/extra properties are allowed (LLM prompts already constrain the
 * shape; rejecting extras would make the pipeline brittle to model drift).
 *
 * @see validateAgainstJsonSchema — returns aggregated errors, or use
 * @see assertValidAgainstJsonSchema — throws a descriptive error.
 */

function collectTypeErrors(value, schema, pathRef, errors) {
  const type = schema.type;
  if (type === undefined) return true;
  const types = Array.isArray(type) ? type : [type];
  const matches = types.some((t) => {
    switch (t) {
      case 'object':
        return value !== null && typeof value === 'object' && !Array.isArray(value);
      case 'array':
        return Array.isArray(value);
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number' && Number.isFinite(value);
      case 'integer':
        return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
      case 'boolean':
        return typeof value === 'boolean';
      case 'null':
        return value === null;
      default:
        return false;
    }
  });
  if (!matches) {
    errors.push(`${pathRef}: type mismatch (expected ${types.join('|')}, got ${describeValue(value)})`);
  }
  return matches;
}

function describeValue(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const t = typeof value;
  if (t === 'object') return 'object';
  if (t === 'string') return 'string';
  if (t === 'number') return 'number';
  if (t === 'boolean') return 'boolean';
  return String(t);
}

function validateNode(value, schema, pathRef, errors) {
  if (schema === true || schema === undefined || schema === null) return;
  if (schema === false) {
    errors.push(`${pathRef}: schema false`);
    return;
  }

  if (!collectTypeErrors(value, schema, pathRef, errors)) return;

  if (schema.enum !== undefined) {
    if (!schema.enum.some((allowed) => allowed === value)) {
      errors.push(`${pathRef}: value ${JSON.stringify(value)} not in enum`);
    }
    return;
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${pathRef}: ${value} < minimum ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${pathRef}: ${value} > maximum ${schema.maximum}`);
    }
    return;
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${pathRef}: string shorter than minLength ${schema.minLength}`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${pathRef}: string longer than maxLength ${schema.maxLength}`);
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${pathRef}: string does not match pattern ${schema.pattern}`);
    }
    return;
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${pathRef}: array shorter than minItems ${schema.minItems}`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${pathRef}: array longer than maxItems ${schema.maxItems}`);
    }
    if (schema.items !== undefined) {
      value.forEach((item, index) => {
        validateNode(item, schema.items, `${pathRef}[${index}]`, errors);
      });
    }
    return;
  }

  if (value !== null && typeof value === 'object') {
    (schema.required || []).forEach((key) => {
      if (value[key] === undefined) {
        errors.push(`${pathRef}.${key}: required property missing`);
      }
    });
    if (schema.properties) {
      Object.entries(schema.properties).forEach(([key, childSchema]) => {
        if (value[key] !== undefined) {
          validateNode(value[key], childSchema, `${pathRef}.${key}`, errors);
        }
      });
    }
  }
}

/**
 * Validates a value against the schema subset.
 * @param {unknown} value
 * @param {Object} schema
 * @returns {{ valid: boolean, errors: Array<string> }}
 */
export function validateAgainstJsonSchema(value, schema) {
  const errors = [];
  validateNode(value, schema, '$', errors);
  return { valid: errors.length === 0, errors };
}

/**
 * Throws a descriptive error (with `validation_errors` and `raw_value`
 * properties) when validation fails.
 * @param {unknown} value
 * @param {Object} schema
 * @param {string} label - human-readable subject name for the error message
 * @throws {Error} message lists all violations; raw_value JSON-sliced to 4000 chars
 */
export function assertValidAgainstJsonSchema(value, schema, label = 'LLM output') {
  const result = validateAgainstJsonSchema(value, schema);
  if (result.valid) return value;
  const error = new Error(`${label} failed schema validation: ${result.errors.join('; ')}`);
  error.validation_errors = result.errors;
  try {
    error.raw_value = JSON.stringify(value).slice(0, 4000);
  } catch (_e) {
    error.raw_value = String(value);
  }
  throw error;
}
