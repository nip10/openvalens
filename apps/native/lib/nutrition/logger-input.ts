/** Hidden numeric fields are read-only: never display or mutate their backing values. */
export function visibleLoggerInput(value: string, hideNumbers: boolean | undefined): string {
  return hideNumbers === false ? value : "";
}

export function canEditLoggerInput(hideNumbers: boolean | undefined): boolean {
  return hideNumbers === false;
}
