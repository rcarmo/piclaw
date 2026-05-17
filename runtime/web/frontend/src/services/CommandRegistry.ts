export type CommandCategory = "navigation" | "terminal" | "session" | "theme" | "general";

export interface Command {
  id: string;
  label: string;
  category: CommandCategory;
  keybinding?: string;
  handler: () => void;
}

export class CommandRegistry {
  private readonly commands = new Map<string, Command>();

  register(cmd: Command): void {
    this.commands.set(cmd.id, cmd);
  }

  unregister(id: string): void {
    this.commands.delete(id);
  }

  search(query: string): Command[] {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return this.getAll();
    }

    return this.getAll().filter((command) => command.label.toLowerCase().includes(normalizedQuery));
  }

  execute(id: string): void {
    const command = this.commands.get(id);

    if (!command) {
      return;
    }

    command.handler();
  }

  getAll(): Command[] {
    return Array.from(this.commands.values());
  }
}

export const commandRegistry = new CommandRegistry();
