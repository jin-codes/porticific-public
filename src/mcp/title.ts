// Human-readable tool title from the snake_case name ("record_buy" -> "Record buy"); acronyms stay upper-case.
const ACRONYMS: Record<string, string> = { dca: 'DCA' }

export function toolTitle(name: string): string {
  const [first, ...rest] = name.split('_').map((w) => ACRONYMS[w] ?? w)
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ')
}
