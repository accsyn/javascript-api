/**
 * Run one expression on a Session, such as session.find("Job").
 * The text must start with "session." (an optional await and a trailing semicolon are ignored).
 */
export async function runSessionCommand(session, command) {
  let text = String(command ?? "").trim();
  if (text.endsWith(";")) {
    text = text.slice(0, -1).trim();
  }
  text = text.replace(/^await\s+/, "");
  if (!text.startsWith("session.")) {
    throw new Error('Enter a command that starts with session., for example session.find("Job")');
  }
  const expression = text.slice("session.".length).trim();
  if (!expression) {
    throw new Error('Enter a command that starts with session., for example session.find("Job")');
  }
  const asyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  return asyncFunction("session", `return session.${expression}`)(session);
}

export function formatResult(value) {
  if (typeof value === "undefined") {
    return "undefined";
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, (_key, nested) => (nested instanceof Date ? nested.toISOString() : nested), 2);
}
