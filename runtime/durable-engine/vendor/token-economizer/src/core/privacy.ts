// SPDX-License-Identifier: Apache-2.0
const environmentValues = new Map<string,readonly string[]>([
  ["PYTHONPATH",[".","src","./src","src:.",".:src"]], ["NODE_ENV",["test","development","production"]],
  ["CI",["1","0","true","false"]], ["PYTHONDONTWRITEBYTECODE",["1","0"]],
]);
export function safeEnvironmentValue(name: string,value: string): boolean {return environmentValues.get(name)?.includes(value) ?? false;}
export function safeEnvironmentName(name: string): boolean {return environmentValues.has(name);}
