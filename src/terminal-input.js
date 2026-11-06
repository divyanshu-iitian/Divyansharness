import { createInterface } from 'node:readline';

// Keep pasted/type-ahead lines while inference is active; readline.question drops them.
export class TerminalInput {
  constructor(input = process.stdin, output = process.stdout) {
    this.output = output;
    this.lines = [];
    this.closed = false;
    this.rl = createInterface({
      input,
      output,
      terminal: !!input.isTTY && !!output.isTTY,
      historySize: 200,
    });
    this.rl.on('line', (line) => {
      if (this.waiting) {
        const resolve = this.waiting;
        this.waiting = null;
        resolve(line);
      } else if (this.lines.length < 100) this.lines.push(line);
    });
    this.rl.on('close', () => {
      this.closed = true;
      const resolve = this.waiting;
      this.waiting = null;
      resolve?.(null);
    });
  }
  async ask(prompt = '') {
    if (this.lines.length) return this.lines.shift();
    if (this.closed) return null;
    this.rl.setPrompt(prompt);
    this.rl.prompt();
    return new Promise((resolve) => {
      this.waiting = resolve;
    });
  }
  close() {
    this.lines = [];
    this.rl.close();
  }
}
