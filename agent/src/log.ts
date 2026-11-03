// Timestamped output. Never pass the agent key to this function.
export function log(message: string) {
  console.log(`[${new Date().toLocaleTimeString()}] ${message}`);
}