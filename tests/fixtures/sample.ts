import { readFile } from "fs/promises";
import path from "path";

export function greet(name: string): string {
  return `Hello, ${name}`;
}

export const formatDate = (date: Date): string => {
  return date.toISOString();
};

function internal() {
  greet("world");
  formatDate(new Date());
}

export class UserService {
  getUser(id: string) {
    return readFile(path.join("users", id));
  }
}
