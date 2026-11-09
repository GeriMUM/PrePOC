type Env = Record<string, string | undefined>;

/** The coach is a Copilot Studio agent in the company tenant; without its Direct Line secret the chat is disabled. */
export const directLineSecret = (env: Env = process.env) => env.COPILOT_DIRECT_LINE_SECRET?.trim() || undefined;
