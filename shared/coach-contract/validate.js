// Validador mínimo de JSON Schema (subconjunto) para el contrato del coach.
// Lo usan el navegador (antes de enviar un CoachRequest) y el Worker (entrada y salida
// del LLM). Sin dependencias para que funcione igual en Vite, Vitest y workerd.
//
// Palabras clave soportadas: type (string o arreglo de tipos, con "integer" y "null"),
// properties, required, additionalProperties (solo false), enum, const, items,
// minItems, maxItems, minimum, maximum, maxLength. `description` se ignora.

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function matchesType(value, type) {
  const actual = typeOf(value);
  if (type === 'number') return actual === 'number' || actual === 'integer';
  return actual === type;
}

/**
 * Valida `value` contra `schema`. Devuelve la lista de errores (vacía si es válido).
 * @param {unknown} value
 * @param {object} schema
 * @param {string} [path]
 * @returns {string[]}
 */
export function validate(value, schema, path = '$') {
  const errors = [];
  if (!schema || typeof schema !== 'object') return errors;

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(value, t))) {
      errors.push(`${path}: se esperaba ${types.join('|')}, llegó ${typeOf(value)}`);
      return errors;
    }
  }
  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${path}: debe ser ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum && !schema.enum.includes(value)) {
    // En tipos anulables, null es válido aunque no esté en el enum.
    const nullable = Array.isArray(schema.type) && schema.type.includes('null');
    if (!(nullable && value === null)) errors.push(`${path}: valor fuera del enum (${JSON.stringify(value)})`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: menor que ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: mayor que ${schema.maximum}`);
  }
  if (typeof value === 'string' && schema.maxLength !== undefined && value.length > schema.maxLength) {
    errors.push(`${path}: más de ${schema.maxLength} caracteres`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: menos de ${schema.minItems} elementos`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: más de ${schema.maxItems} elementos`);
    if (schema.items) value.forEach((item, i) => errors.push(...validate(item, schema.items, `${path}[${i}]`)));
  }
  if (typeOf(value) === 'object') {
    const props = schema.properties ?? {};
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${path}.${key}: falta`);
    }
    for (const [key, v] of Object.entries(value)) {
      if (props[key]) errors.push(...validate(v, props[key], `${path}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${path}.${key}: propiedad no permitida`);
    }
  }
  return errors;
}

/**
 * Quita del schema las palabras clave que no van al LLM (Gemini ignora maxLength, minimum…
 * y algunas versiones rechazan claves desconocidas). Devuelve una copia.
 * @param {object} schema
 */
export function toLlmSchema(schema) {
  const DROP = new Set(['maxLength', 'minimum', 'maximum', '$schema', '$id', 'title']);
  const walk = (node) => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (DROP.has(k)) continue;
      out[k] = k === 'properties' ? Object.fromEntries(Object.entries(v).map(([p, s]) => [p, walk(s)])) : walk(v);
    }
    return out;
  };
  return walk(schema);
}
